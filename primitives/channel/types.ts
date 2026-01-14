/**
 * Channel Types - Unified Pub/Sub Abstraction
 *
 * Replaces the 4 EventEmitter variants (Node, Pusher, SocketIO, Ably)
 * with a single, unified Channel interface.
 */

/**
 * Handler function type for event callbacks
 */
export type Handler<T = unknown> = (data: T, event?: string) => void

/**
 * Subscription object returned by subscribe()
 * Provides ID for tracking and unsubscribe method
 */
export interface Subscription {
  /** Unique subscription identifier */
  id: string
  /** Unsubscribe from the event */
  unsubscribe(): void
}

/**
 * Presence member info
 */
export interface Member {
  /** Unique member identifier */
  id: string
  /** Optional member metadata */
  info?: Record<string, unknown>
}

/**
 * Presence tracking for channels
 */
export interface Presence {
  /** Async iterator of current members */
  members(): AsyncIterable<Member>
  /** Join the presence set */
  join(member: Member): Promise<void>
  /** Leave the presence set */
  leave(): Promise<void>
  /** Handler for member join events */
  onJoin(handler: Handler<Member>): Subscription
  /** Handler for member leave events */
  onLeave(handler: Handler<Member>): Subscription
}

/**
 * Persistence configuration for durable channels
 */
export interface PersistenceConfig {
  /** Maximum number of messages to retain */
  maxMessages?: number
  /** Maximum age of messages in milliseconds */
  maxAge?: number
  /** Storage backend (defaults to memory) */
  storage?: 'memory' | 'do' | 'kv'
}

/**
 * Drop strategy for backpressure handling
 */
export type DropStrategy = 'oldest' | 'newest'

/**
 * Channel type classification
 */
export type ChannelType = 'public' | 'private' | 'presence'

/**
 * API compatibility style for factory function
 */
export type ChannelStyle = 'node' | 'pusher' | 'socketio' | 'ably'

/**
 * Options for channel creation
 */
export interface ChannelOptions {
  /** Channel type (default: public) */
  type?: ChannelType
  /** API style for compatibility (default: node) */
  style?: ChannelStyle
}

/**
 * Stored message for persistence
 */
export interface StoredMessage<T = unknown> {
  /** Message ID */
  id: string
  /** Event name */
  event: string
  /** Message data */
  data: T
  /** Timestamp */
  timestamp: number
}

/**
 * Unified Channel interface
 *
 * Core pub/sub abstraction that can operate in multiple modes:
 * - Basic: Simple publish/subscribe
 * - Presence: Track connected members
 * - Buffered: Backpressure handling
 * - Persistent: Survive DO hibernation
 */
export interface Channel<T = unknown> {
  /** Channel name */
  readonly name: string
  /** Channel type (public, private, presence) */
  readonly type: ChannelType

  // =========================================================================
  // Pub/Sub
  // =========================================================================

  /**
   * Publish data to an event
   * @param event Event name
   * @param data Data to publish
   */
  publish(event: string, data: T): Promise<void>

  /**
   * Subscribe to an event
   * @param event Event name or '*' for all events
   * @param handler Callback function
   * @returns Subscription object
   */
  subscribe(event: string | '*', handler: Handler<T>): Subscription

  /**
   * Unsubscribe using subscription object
   * @param subscription Subscription to cancel
   */
  unsubscribe(subscription: Subscription): void

  // =========================================================================
  // Presence (optional - only on presence channels)
  // =========================================================================

  /** Presence tracking (only available on presence channels) */
  presence?: Presence

  // =========================================================================
  // Backpressure
  // =========================================================================

  /**
   * Set buffer capacity for pending messages
   * @param capacity Maximum messages to buffer
   */
  buffer(capacity: number): this

  /**
   * Set drop strategy to drop oldest messages when buffer full
   */
  dropOldest(): this

  /**
   * Set drop strategy to drop newest messages when buffer full
   */
  dropNewest(): this

  // =========================================================================
  // Durability
  // =========================================================================

  /**
   * Enable persistence for message replay and durability
   * @param config Persistence configuration
   */
  persistent(config: PersistenceConfig): this
}
