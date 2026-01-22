/**
 * @dotdo/core - Events Interface
 *
 * Events are immutable facts that happened. Once created, they never change.
 * Events enable:
 * - Audit logging
 * - Event sourcing (reconstructing state from history)
 * - Real-time notifications
 * - Cross-service communication
 */

import type { StorableData } from './types'

// =============================================================================
// Event Type
// =============================================================================

/**
 * Event - An immutable record of something that happened
 *
 * Events are append-only and never modified. They capture:
 * - What happened (type)
 * - What it's about (subject)
 * - The details (data)
 * - Who caused it (actor)
 * - When it happened (timestamp)
 *
 * @example
 * ```typescript
 * const event: Event<{ name: string; email: string }> = {
 *   id: 'event-123',
 *   type: 'User.created',
 *   subject: 'https://app.do/User/user-456',
 *   data: { name: 'Alice', email: 'alice@example.com' },
 *   actor: 'user-admin',
 *   source: 'api',
 *   timestamp: new Date()
 * }
 * ```
 */
export interface Event<T extends StorableData = StorableData> {
  // Identity
  /** Unique identifier */
  id: string

  /** Event type (e.g., 'User.created', 'Order.shipped') */
  type: string

  // Content
  /** Thing URL this event is about */
  subject: string

  /** Event-specific payload */
  data: T

  // Context
  /** Who/what caused this (user ID, system, action ID) */
  actor: string

  /** Where it came from (service name, DO name, etc.) */
  source: string

  // Timing
  /** When it happened (immutable) */
  timestamp: Date

  // Correlation
  /** Group related events */
  correlationId?: string

  /** Event/Action that caused this */
  causationId?: string

  /** Action this event is part of */
  actionId?: string
}

// =============================================================================
// Event Input Types
// =============================================================================

/**
 * Input for emitting an event
 */
export interface EmitEventInput<T extends StorableData = StorableData> {
  /** Event type */
  type: string

  /** Subject Thing URL */
  subject: string

  /** Event data */
  data: T

  /** Actor (auto-detected if not provided) */
  actor?: string

  /** Source (auto-detected if not provided) */
  source?: string

  /** Correlation ID for grouping */
  correlationId?: string

  /** Event/Action that caused this */
  causationId?: string

  /** Associated action ID */
  actionId?: string
}

/**
 * Options for querying events
 */
export interface QueryEventsOptions {
  /** Filter by event type */
  type?: string

  /** Filter by subject Thing URL */
  subject?: string

  /** Filter by actor */
  actor?: string

  /** Filter by source */
  source?: string

  /** Filter by correlation ID */
  correlationId?: string

  /** Filter by action ID */
  actionId?: string

  /** Events after this timestamp */
  after?: Date

  /** Events before this timestamp */
  before?: Date

  /** Maximum number of results */
  limit?: number

  /** Number of results to skip */
  offset?: number

  /** Sort order (default: desc - newest first) */
  order?: 'asc' | 'desc'
}

/**
 * Options for subscribing to events
 */
export interface SubscribeEventsOptions {
  /** Filter by event type (supports wildcards like 'User.*') */
  type?: string

  /** Filter by subject Thing URL */
  subject?: string

  /** Filter by actor */
  actor?: string

  /** Start from this event ID (for replay) */
  fromEventId?: string

  /** Start from this timestamp (for replay) */
  fromTimestamp?: Date
}

// =============================================================================
// Events Client Interface
// =============================================================================

/**
 * EventsClient - Interface for managing events
 *
 * Events are immutable - once emitted, they cannot be modified or deleted.
 *
 * @example
 * ```typescript
 * // Emit an event
 * const event = await db.emit({
 *   type: 'Order.created',
 *   subject: 'https://app.do/Order/order-123',
 *   data: { total: 99.99, items: ['item-1', 'item-2'] },
 *   actor: 'user-456'
 * })
 *
 * // Query events for an entity
 * const history = await db.queryEvents({
 *   subject: 'https://app.do/Order/order-123',
 *   order: 'asc'  // Oldest first for replay
 * })
 *
 * // Subscribe to real-time events
 * for await (const event of db.subscribeEvents({ type: 'Order.*' })) {
 *   console.log('Order event:', event)
 * }
 * ```
 */
export interface EventsClient {
  /**
   * Emit an event (append-only)
   *
   * @param options - Event emission options
   * @returns The created event
   */
  emit<T extends StorableData>(options: EmitEventInput<T>): Promise<Event<T>>

  /**
   * Get an event by ID
   *
   * @param id - Event ID
   * @returns The event or null if not found
   */
  getEvent(id: string): Promise<Event | null>

  /**
   * Query events with filtering
   *
   * @param options - Query options
   * @returns Array of matching events
   */
  queryEvents(options: QueryEventsOptions): Promise<Event[]>

  /**
   * Subscribe to events (real-time streaming)
   *
   * Returns an async iterable that yields events as they occur.
   * Can also replay historical events if fromEventId/fromTimestamp is provided.
   *
   * @param options - Subscription options
   * @returns Async iterable of events
   */
  subscribeEvents(options: SubscribeEventsOptions): AsyncIterable<Event>

  /**
   * Count events matching criteria
   *
   * @param options - Query options (same as queryEvents)
   * @returns Number of matching events
   */
  countEvents?(options: QueryEventsOptions): Promise<number>
}

// =============================================================================
// Event Sourcing Helpers
// =============================================================================

/**
 * Event handler type for event sourcing
 *
 * @example
 * ```typescript
 * const handlers: Record<string, EventHandler<OrderState>> = {
 *   'Order.created': (state, event) => ({
 *     ...event.data,
 *     status: 'pending'
 *   }),
 *   'Order.paid': (state, event) => ({
 *     ...state,
 *     status: 'paid',
 *     paidAt: event.timestamp
 *   }),
 *   'Order.shipped': (state, event) => ({
 *     ...state,
 *     status: 'shipped',
 *     trackingNumber: event.data.trackingNumber
 *   })
 * }
 * ```
 */
export type EventHandler<TState, TEvent extends StorableData = StorableData> = (
  state: TState | null,
  event: Event<TEvent>
) => TState

/**
 * Replay events to reconstruct state
 *
 * @param events - Array of events in chronological order
 * @param handlers - Map of event type to handler
 * @param initialState - Initial state (default: null)
 * @returns Final state after replaying all events
 *
 * @example
 * ```typescript
 * const events = await db.queryEvents({
 *   subject: 'https://app.do/Order/order-123',
 *   order: 'asc'
 * })
 *
 * const orderState = replayEvents(events, {
 *   'Order.created': (_, e) => ({ ...e.data, status: 'pending' }),
 *   'Order.paid': (s, e) => ({ ...s, status: 'paid' }),
 *   'Order.shipped': (s, e) => ({ ...s, status: 'shipped' })
 * })
 * ```
 */
export function replayEvents<TState>(
  events: Event[],
  handlers: Record<string, EventHandler<TState>>,
  initialState: TState | null = null
): TState | null {
  let state = initialState

  for (const event of events) {
    const handler = handlers[event.type]
    if (handler) {
      state = handler(state, event)
    }
  }

  return state
}

// =============================================================================
// Standard Event Types
// =============================================================================

/**
 * Standard event types that actions emit
 */
export type StandardActionEventType =
  | 'Action.created'
  | 'Action.started'
  | 'Action.completed'
  | 'Action.failed'
  | 'Action.cancelled'
  | 'Action.retrying'

/**
 * Standard CRUD event types for entities
 */
export type StandardCrudEventType<T extends string = string> =
  | `${T}.created`
  | `${T}.updated`
  | `${T}.deleted`
