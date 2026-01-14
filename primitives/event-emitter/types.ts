/**
 * TypedEventEmitter Types
 *
 * A comprehensive type-safe event system for the dotdo platform.
 */

/**
 * Maps event names to their payload types
 */
export type EventMap = Record<string, unknown>

/**
 * Callback function type for event handlers
 */
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>

/**
 * Async callback function type
 */
export type AsyncEventHandler<T = unknown> = (payload: T) => Promise<void>

/**
 * Options for event subscription
 */
export interface EventOptions {
  /** Fire handler only once then auto-unsubscribe */
  once?: boolean
  /** Handler priority (higher runs first, default 0) */
  priority?: number
  /** Filter function - handler only runs if filter returns true */
  filter?: (payload: unknown) => boolean
}

/**
 * Represents an active event subscription
 */
export interface EventSubscription {
  /** Unique identifier for this subscription */
  id: string
  /** Function to unsubscribe this handler */
  unsubscribe: () => void
}

/**
 * Handler that receives all events (wildcard)
 */
export type WildcardHandler<Events extends EventMap = EventMap> = <K extends keyof Events>(
  event: K,
  payload: Events[K]
) => void | Promise<void>

/**
 * Middleware to transform or filter events before handlers
 */
export type EventMiddleware<T = unknown> = (
  event: string,
  payload: T
) => T | null | Promise<T | null>

/**
 * Internal handler storage with metadata
 */
export interface StoredHandler<T = unknown> {
  id: string
  handler: EventHandler<T>
  options: EventOptions
}

/**
 * Event record for history tracking
 */
export interface EventRecord<T = unknown> {
  event: string
  payload: T
  timestamp: number
}
