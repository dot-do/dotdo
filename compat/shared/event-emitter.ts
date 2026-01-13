/**
 * Shared EventEmitter implementation for compat SDKs
 *
 * This is a lightweight, edge-compatible EventEmitter that supports:
 * - Standard on/off/emit/once pattern
 * - removeAllListeners
 * - listenerCount
 * - Type-safe event handling with generics
 *
 * Used by: postgres, mysql, tidb, neon, cockroach, ably, pusher, socketio
 */

// ============================================================================
// BASE EVENT EMITTER
// ============================================================================

/**
 * Generic event handler type
 */
export type EventHandler = (...args: unknown[]) => void

/**
 * Listener entry with once flag for efficient once() handling
 */
interface ListenerEntry {
  callback: EventHandler
  once: boolean
}

/**
 * Base EventEmitter class for SQL database compat layers
 *
 * Provides standard Node.js EventEmitter-like API:
 * - on(event, handler) - Add listener
 * - off(event, handler) - Remove specific listener
 * - emit(event, ...args) - Emit event to listeners
 * - once(event, handler) - Add one-time listener
 * - removeListener(event, handler) - Alias for off
 * - removeAllListeners(event?) - Remove all listeners
 * - listenerCount(event) - Get number of listeners
 */
export class EventEmitter {
  protected _handlers = new Map<string, Set<ListenerEntry>>()

  /**
   * Add a listener for an event
   * Emits 'newListener' before adding (Node.js EventEmitter compatibility)
   */
  on(event: string, handler: EventHandler): this {
    // Emit 'newListener' before adding the listener (Node.js compatibility)
    // Skip emitting 'newListener' for 'newListener' itself to prevent infinite recursion
    if (event !== 'newListener' && this._handlers.has('newListener')) {
      this.emit('newListener', event, handler)
    }

    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set())
    }
    this._handlers.get(event)!.add({ callback: handler, once: false })
    return this
  }

  /**
   * Add a one-time listener for an event
   * Emits 'newListener' before adding (Node.js EventEmitter compatibility)
   */
  once(event: string, handler: EventHandler): this {
    // Emit 'newListener' before adding the listener (Node.js compatibility)
    // Skip emitting 'newListener' for 'newListener' itself to prevent infinite recursion
    if (event !== 'newListener' && this._handlers.has('newListener')) {
      this.emit('newListener', event, handler)
    }

    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set())
    }
    this._handlers.get(event)!.add({ callback: handler, once: true })
    return this
  }

  /**
   * Remove a specific listener for an event
   */
  off(event: string, handler: EventHandler): this {
    const handlers = this._handlers.get(event)
    if (handlers) {
      for (const entry of handlers) {
        if (entry.callback === handler) {
          handlers.delete(entry)
          break
        }
      }
    }
    return this
  }

  /**
   * Alias for off() - Node.js EventEmitter compatibility
   */
  removeListener(event: string, handler: EventHandler): this {
    return this.off(event, handler)
  }

  /**
   * Emit an event to all listeners
   * Handles both sync and async handlers - async errors are emitted to 'error' event
   * @returns true if there were listeners, false otherwise
   */
  emit(event: string, ...args: unknown[]): boolean {
    const handlers = this._handlers.get(event)
    if (!handlers || handlers.size === 0) return false

    const toRemove: ListenerEntry[] = []

    for (const entry of handlers) {
      try {
        const result = entry.callback(...args)
        // Handle async handlers - catch promise rejections and emit to error
        if (result instanceof Promise) {
          result.catch((e) => {
            if (event !== 'error') {
              this.emit('error', e)
            }
          })
        }
      } catch (e) {
        // Emit to error handler if not error event (sync errors)
        if (event !== 'error') {
          this.emit('error', e)
        }
      }
      if (entry.once) {
        toRemove.push(entry)
      }
    }

    // Remove once listeners after iteration
    for (const entry of toRemove) {
      handlers.delete(entry)
    }

    return true
  }

  /**
   * Remove all listeners for an event, or all listeners if no event specified
   */
  removeAllListeners(event?: string): this {
    if (event) {
      this._handlers.delete(event)
    } else {
      this._handlers.clear()
    }
    return this
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: string): number {
    return this._handlers.get(event)?.size ?? 0
  }

  /**
   * Get all listeners for an event
   */
  listeners(event: string): EventHandler[] {
    const handlers = this._handlers.get(event)
    if (!handlers) return []
    return Array.from(handlers).map((entry) => entry.callback)
  }
}

/**
 * SharedEventEmitter - alias for EventEmitter
 * Used by multiple compat layers (postgres, mysql, etc.)
 */
export { EventEmitter as SharedEventEmitter }

// ============================================================================
// TYPED EVENT EMITTER (for Ably-style APIs)
// ============================================================================

/**
 * Typed EventEmitter for APIs that need type-safe events
 *
 * Supports:
 * - on(event | event[], listener) - Array of events
 * - once(event | event[], listener)
 * - off(event?, listener?) - Optional params for clearing all
 *
 * Used by: Ably SDK
 */
export class TypedEventEmitter<T = unknown> {
  protected _listeners: Map<string, Set<{ callback: (data: T) => void; once: boolean }>> = new Map()

  on(event: string | string[], listener: (data: T) => void): void {
    const events = Array.isArray(event) ? event : [event]
    for (const e of events) {
      if (!this._listeners.has(e)) {
        this._listeners.set(e, new Set())
      }
      this._listeners.get(e)!.add({ callback: listener, once: false })
    }
  }

  once(event: string | string[], listener: (data: T) => void): void {
    const events = Array.isArray(event) ? event : [event]
    for (const e of events) {
      if (!this._listeners.has(e)) {
        this._listeners.set(e, new Set())
      }
      this._listeners.get(e)!.add({ callback: listener, once: true })
    }
  }

  off(event?: string | string[], listener?: (data: T) => void): void {
    if (event === undefined) {
      this._listeners.clear()
      return
    }

    const events = Array.isArray(event) ? event : [event]
    for (const e of events) {
      if (listener === undefined) {
        this._listeners.delete(e)
      } else {
        const listeners = this._listeners.get(e)
        if (listeners) {
          for (const entry of listeners) {
            if (entry.callback === listener) {
              listeners.delete(entry)
            }
          }
        }
      }
    }
  }

  protected _emit(event: string, data: T): void {
    const listeners = this._listeners.get(event)
    if (listeners) {
      for (const entry of listeners) {
        try {
          const result = entry.callback(data)
          // Handle async handlers - emit to 'error' event
          if (result instanceof Promise) {
            result.catch((error) => {
              if (event !== 'error') {
                this._emitError(error)
              }
            })
          }
        } catch (error) {
          // Emit to 'error' event instead of just logging (sync errors)
          if (event !== 'error') {
            this._emitError(error)
          }
        }
        if (entry.once) {
          listeners.delete(entry)
        }
      }
    }
  }

  /**
   * Emit error to 'error' listeners, with console.error fallback
   */
  private _emitError(error: unknown): void {
    const errorListeners = this._listeners.get('error')
    if (errorListeners && errorListeners.size > 0) {
      for (const entry of errorListeners) {
        try {
          entry.callback(error)
        } catch {
          // Avoid infinite loops - just log if error handler throws
          console.error('Error in error handler:', error)
        }
      }
    } else {
      // Fallback to console.error if no error listeners
      console.error('Unhandled event handler error:', error)
    }
  }
}

// ============================================================================
// PUSHER-STYLE EVENT EMITTER
// ============================================================================

/**
 * Global event handler type for Pusher-style bind_global
 */
export type GlobalEventHandler = (event: string, data?: unknown) => void

/**
 * Pusher-style EventEmitter with bind/unbind API
 *
 * Supports:
 * - bind(event, callback) - Add listener
 * - unbind(event?, callback?) - Remove listeners
 * - bind_global(callback) - Add global listener for all events
 * - unbind_global(callback?) - Remove global listeners
 *
 * Used by: Pusher SDK
 */
export class PusherEventEmitter {
  protected _listeners: Map<string, Set<EventHandler>> = new Map()
  protected _globalListeners: Set<GlobalEventHandler> = new Set()

  bind(event: string, callback: EventHandler): this {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event)!.add(callback)
    return this
  }

  unbind(event?: string, callback?: EventHandler): this {
    if (event === undefined) {
      // Unbind all
      this._listeners.clear()
    } else if (callback === undefined) {
      // Unbind all for event
      this._listeners.delete(event)
    } else {
      // Unbind specific callback
      const listeners = this._listeners.get(event)
      if (listeners) {
        listeners.delete(callback)
      }
    }
    return this
  }

  bind_global(callback: GlobalEventHandler): this {
    this._globalListeners.add(callback)
    return this
  }

  unbind_global(callback?: GlobalEventHandler): this {
    if (callback === undefined) {
      this._globalListeners.clear()
    } else {
      this._globalListeners.delete(callback)
    }
    return this
  }

  protected _emit(event: string, data?: unknown): void {
    // Call specific event listeners
    const listeners = this._listeners.get(event)
    if (listeners) {
      for (const callback of listeners) {
        try {
          const result = callback(data)
          // Handle async handlers
          if (result instanceof Promise) {
            result.catch((error) => {
              if (event !== 'error') {
                this._emitError(error)
              }
            })
          }
        } catch (error) {
          if (event !== 'error') {
            this._emitError(error)
          }
        }
      }
    }

    // Call global listeners
    for (const callback of this._globalListeners) {
      try {
        const result = callback(event, data)
        // Handle async handlers
        if (result instanceof Promise) {
          result.catch((error) => this._emitError(error))
        }
      } catch (error) {
        this._emitError(error)
      }
    }
  }

  /**
   * Emit error to 'error' listeners, with console.error fallback
   */
  private _emitError(error: unknown): void {
    const errorListeners = this._listeners.get('error')
    if (errorListeners && errorListeners.size > 0) {
      for (const callback of errorListeners) {
        try {
          callback(error)
        } catch {
          console.error('Error in error handler:', error)
        }
      }
    } else {
      console.error('Unhandled event handler error:', error)
    }
  }
}

// ============================================================================
// SOCKET.IO-STYLE EVENT EMITTER
// ============================================================================

/**
 * Socket.IO-style EventEmitter with extended API
 *
 * Supports:
 * - on/once/off/removeAllListeners - Standard API
 * - listeners(event) - Get all listeners
 * - hasListeners(event) - Check if event has listeners
 * - onAny/prependAny/offAny/listenersAny - Catch-all listeners
 * - onAnyOutgoing/prependAnyOutgoing/offAnyOutgoing/listenersAnyOutgoing - Outgoing catch-all
 *
 * Used by: Socket.IO SDK
 */
export class SocketIOEventEmitter {
  protected _events: Map<string, Set<EventHandler>> = new Map()
  protected _onceEvents: Map<string, Set<EventHandler>> = new Map()
  protected _anyListeners: ((event: string, ...args: unknown[]) => void)[] = []
  protected _anyOutgoingListeners: ((event: string, ...args: unknown[]) => void)[] = []

  on(event: string, listener: EventHandler): this {
    if (!this._events.has(event)) {
      this._events.set(event, new Set())
    }
    this._events.get(event)!.add(listener)
    return this
  }

  once(event: string, listener: EventHandler): this {
    if (!this._onceEvents.has(event)) {
      this._onceEvents.set(event, new Set())
    }
    this._onceEvents.get(event)!.add(listener)
    return this
  }

  off(event: string, listener?: EventHandler): this {
    if (!listener) {
      this._events.delete(event)
      this._onceEvents.delete(event)
    } else {
      this._events.get(event)?.delete(listener)
      this._onceEvents.get(event)?.delete(listener)
    }
    return this
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this._events.delete(event)
      this._onceEvents.delete(event)
    } else {
      this._events.clear()
      this._onceEvents.clear()
    }
    return this
  }

  protected _emit(event: string, ...args: unknown[]): boolean {
    const listeners = this._events.get(event)
    const onceListeners = this._onceEvents.get(event)

    let hasListeners = false

    // Notify catch-all listeners with error handling
    for (const listener of this._anyListeners) {
      try {
        const result = listener(event, ...args)
        if (result instanceof Promise) {
          result.catch((error) => this._emitError(error))
        }
      } catch (error) {
        this._emitError(error)
      }
    }

    if (listeners && listeners.size > 0) {
      hasListeners = true
      for (const listener of listeners) {
        try {
          const result = listener(...args)
          if (result instanceof Promise) {
            result.catch((error) => {
              if (event !== 'error') {
                this._emitError(error)
              }
            })
          }
        } catch (e) {
          if (event !== 'error') {
            this._emitError(e)
          }
        }
      }
    }

    if (onceListeners && onceListeners.size > 0) {
      hasListeners = true
      for (const listener of onceListeners) {
        try {
          const result = listener(...args)
          if (result instanceof Promise) {
            result.catch((error) => {
              if (event !== 'error') {
                this._emitError(error)
              }
            })
          }
        } catch (e) {
          if (event !== 'error') {
            this._emitError(e)
          }
        }
      }
      this._onceEvents.delete(event)
    }

    return hasListeners
  }

  /**
   * Emit error to 'error' listeners, with console.error fallback
   */
  private _emitError(error: unknown): void {
    const errorListeners = this._events.get('error')
    if (errorListeners && errorListeners.size > 0) {
      for (const listener of errorListeners) {
        try {
          listener(error)
        } catch {
          console.error('Error in error handler:', error)
        }
      }
    } else {
      console.error('Unhandled event listener error:', error)
    }
  }

  listeners(event: string): EventHandler[] {
    const listeners: EventHandler[] = []
    const eventListeners = this._events.get(event)
    const onceListeners = this._onceEvents.get(event)

    if (eventListeners) {
      listeners.push(...eventListeners)
    }
    if (onceListeners) {
      listeners.push(...onceListeners)
    }

    return listeners
  }

  hasListeners(event: string): boolean {
    const eventListeners = this._events.get(event)
    const onceListeners = this._onceEvents.get(event)
    return (eventListeners?.size ?? 0) > 0 || (onceListeners?.size ?? 0) > 0
  }

  onAny(listener: (event: string, ...args: unknown[]) => void): this {
    this._anyListeners.push(listener)
    return this
  }

  prependAny(listener: (event: string, ...args: unknown[]) => void): this {
    this._anyListeners.unshift(listener)
    return this
  }

  offAny(listener?: (event: string, ...args: unknown[]) => void): this {
    if (listener) {
      const index = this._anyListeners.indexOf(listener)
      if (index !== -1) {
        this._anyListeners.splice(index, 1)
      }
    } else {
      this._anyListeners = []
    }
    return this
  }

  listenersAny(): ((event: string, ...args: unknown[]) => void)[] {
    return [...this._anyListeners]
  }

  onAnyOutgoing(listener: (event: string, ...args: unknown[]) => void): this {
    this._anyOutgoingListeners.push(listener)
    return this
  }

  prependAnyOutgoing(listener: (event: string, ...args: unknown[]) => void): this {
    this._anyOutgoingListeners.unshift(listener)
    return this
  }

  offAnyOutgoing(listener?: (event: string, ...args: unknown[]) => void): this {
    if (listener) {
      const index = this._anyOutgoingListeners.indexOf(listener)
      if (index !== -1) {
        this._anyOutgoingListeners.splice(index, 1)
      }
    } else {
      this._anyOutgoingListeners = []
    }
    return this
  }

  listenersAnyOutgoing(): ((event: string, ...args: unknown[]) => void)[] {
    return [...this._anyOutgoingListeners]
  }
}
