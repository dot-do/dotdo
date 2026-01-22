/**
 * Shared $Context Interface Types
 *
 * This module defines the common API surface shared between:
 * - Server-side $ (WorkflowContext) - runs inside a Durable Object
 * - Client-side $ ($Context) - connects remotely via RPC/WebSocket
 *
 * The goal is that code using these common interfaces works identically
 * regardless of whether it runs server-side or client-side.
 *
 * @module do/shared-context
 */

// ============================================================================
// THING TYPES
// ============================================================================

/**
 * Base Thing interface - common to both client and server.
 * Things are the fundamental storage entities in dotdo.
 */
export interface Thing {
  /** Unique identifier */
  $id: string
  /** Entity type (e.g., 'Customer', 'Order') */
  $type: string
  /** Creation timestamp (epoch ms) */
  $createdAt?: number
  /** Last update timestamp (epoch ms) */
  $updatedAt?: number
  /** Additional dynamic properties */
  [key: string]: unknown
}

/**
 * Result of a list query
 */
export interface ListResult<T> {
  items: T[]
  total: number
  hasMore: boolean
  cursor?: string
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Event payload passed to handlers.
 * Contains both metadata and the actual payload.
 */
export interface EventPayload<T = unknown> {
  /** Event type (e.g., 'Customer.signup') */
  type: string
  /** The actual event payload data */
  payload: T
  /** Unique event ID */
  $id: string
  /** Timestamp when the event was created */
  $timestamp: number
  /** Optional source identifier */
  source?: string
}

/**
 * Event handler function type
 */
export type EventHandler<T = unknown> = (event: EventPayload<T>) => void | Promise<void>

/**
 * Unsubscribe function returned from event subscriptions
 */
export type UnsubscribeFn = () => void

// ============================================================================
// THINGS API
// ============================================================================

/**
 * API for CRUD operations on Things.
 * This interface is shared between client and server.
 */
export interface ThingsAPI {
  /**
   * Create a new Thing.
   * @param data - Must include $type and any other properties
   * @returns The created Thing with generated $id
   */
  create(data: { $type: string; [key: string]: unknown }): Promise<Thing>

  /**
   * Get a Thing by ID.
   * @param id - The $id of the Thing
   * @returns The Thing if found, null otherwise
   */
  get(id: string): Promise<Thing | null>

  /**
   * List Things with filtering and pagination.
   * @param options - Query options including $type filter
   * @returns Paginated list result
   */
  list(options: {
    $type: string
    limit?: number
    offset?: number
    cursor?: string
    where?: Record<string, unknown>
  }): Promise<ListResult<Thing>>

  /**
   * Update a Thing by ID.
   * @param id - The $id of the Thing
   * @param data - Properties to update
   * @returns The updated Thing
   */
  update(id: string, data: Record<string, unknown>): Promise<Thing>

  /**
   * Delete a Thing by ID.
   * @param id - The $id of the Thing
   * @returns Deletion result
   */
  delete(id: string): Promise<{ deleted: boolean }>
}

// ============================================================================
// EVENTS API
// ============================================================================

/**
 * API for event emission and subscription.
 * This interface is shared between client and server.
 */
export interface EventsAPI {
  /**
   * Emit an event.
   * @param event - The event to emit
   * @param options - Emission options
   * @returns Event metadata or queued status
   */
  emit(
    event: { type: string; payload?: unknown },
    options?: { fireAndForget?: boolean }
  ): Promise<{ $id: string; $timestamp: number } | { queued: boolean }>

  /**
   * Subscribe to events matching a pattern.
   * @param event - Event type or pattern (e.g., 'Customer.signup', 'Customer.*')
   * @param handler - Handler function
   * @returns Unsubscribe function
   */
  subscribe(event: string, handler: EventHandler): UnsubscribeFn

  /**
   * Query historical events.
   * @param options - Query options
   * @returns Matching events
   */
  query(options: {
    type: string
    since?: number
    until?: number
    limit?: number
  }): Promise<{ items: EventPayload[]; total: number }>
}

// ============================================================================
// ON PROXY ($.on.Noun.verb)
// ============================================================================

/**
 * Proxy for verb-level event handler registration.
 * $.on.Customer.signup(handler)
 */
export interface OnNounProxy {
  [verb: string]: (handler: EventHandler) => UnsubscribeFn | void
}

/**
 * Proxy for noun-level event handler access.
 * $.on.Customer -> OnNounProxy
 */
export interface OnProxy {
  [noun: string]: OnNounProxy
}

// ============================================================================
// ENTITY PROXY ($.Noun(id))
// ============================================================================

/**
 * Proxy for entity instance operations.
 * $.Customer('cust-123').getProfile()
 */
export interface EntityProxy {
  /** Update the entity */
  update(data: Record<string, unknown>): Promise<Thing>
  // Note: Dynamic methods are accessed via Proxy, not typed here
  // to avoid TypeScript index signature conflicts
}

/**
 * Factory function for creating entity proxies.
 * $.Customer returns (id) => EntityProxy
 */
export type EntityProxyFactory = (id: string) => EntityProxy

// ============================================================================
// SHARED $CONTEXT INTERFACE
// ============================================================================

/**
 * Core $ context interface shared between client and server.
 *
 * This interface defines the operations that work identically in both:
 * - Server-side: WorkflowContext ($) inside a DO
 * - Client-side: $Context connecting remotely
 *
 * @example
 * ```typescript
 * // This code works in both contexts:
 * await $.things.create({ $type: 'Customer', name: 'Alice' })
 * $.on.Customer.created((event) => console.log(event.payload))
 * const profile = await $.Customer('cust-123').getProfile()
 * ```
 */
export interface SharedContextAPI {
  /**
   * CRUD operations for Things.
   * Server: maps to ThingsStore
   * Client: maps to RPC calls
   */
  things: ThingsAPI

  /**
   * Event operations.
   * Server: maps to EventsStore
   * Client: maps to RPC/WebSocket
   */
  events: EventsAPI

  /**
   * Event handler registration via $.on.Noun.verb(handler).
   * Server: registers local handlers
   * Client: registers remote handlers via WebSocket
   */
  on: OnProxy

  /**
   * Entity proxy access via $.Noun(id).
   * Returns a proxy for calling methods on entities.
   *
   * @example
   * ```typescript
   * const profile = await $.Customer('cust-123').getProfile()
   * await $.Order('order-456').ship()
   * ```
   */
  [noun: string]: EntityProxyFactory | unknown
}

/**
 * Options for durability levels.
 * Used by $.do() for retry configuration.
 */
export interface DoOptions {
  /** Number of retry attempts (default: 3) */
  retries?: number
  /** Backoff strategy (default: 'exponential') */
  backoff?: 'linear' | 'exponential'
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * Extended $ context interface with server-side only features.
 * These features are only available when running inside a DO.
 */
export interface ServerContextExtensions {
  /**
   * Fire-and-forget event emission.
   * Events are processed asynchronously without waiting.
   */
  send(event: { type: string; payload?: unknown }): void

  /**
   * Single attempt execution (no retries).
   */
  try<T>(action: () => Promise<T>, options?: { timeout?: number }): Promise<T>

  /**
   * Durable execution with retries.
   */
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>

  /**
   * Scheduling DSL.
   * $.every.Monday.at('9am')(handler)
   */
  every: unknown

  /**
   * Integration registry for third-party services.
   */
  integrations: unknown

  /**
   * Database schema definition.
   */
  DB(schemas: Record<string, Record<string, string | unknown>>): void
}

/**
 * Extended $ context interface with client-side only features.
 * These features are only available when connecting remotely.
 */
export interface ClientContextExtensions {
  /**
   * Connect to the DO (establishes WebSocket).
   */
  connect(): Promise<void>

  /**
   * Disconnect from the DO.
   */
  disconnect(): Promise<void>

  /**
   * Check if connected.
   */
  isConnected(): boolean

  /**
   * Register connection state handlers.
   */
  onConnected(handler: () => void): void
  onDisconnected(handler: () => void): void
  onReconnecting(handler: () => void): void
  onError(handler: (error: Error) => void): void
  onHandlerError(handler: (error: Error, event: EventPayload) => void): void

  /**
   * Register middleware.
   */
  use(middleware: (request: RequestInit) => RequestInit): void
  useResponse(middleware: (response: unknown) => unknown): void
}

/**
 * Type guard to check if context has server extensions.
 */
export function isServerContext(ctx: SharedContextAPI): ctx is SharedContextAPI & ServerContextExtensions {
  return 'send' in ctx && typeof (ctx as unknown as ServerContextExtensions).send === 'function'
}

/**
 * Type guard to check if context has client extensions.
 */
export function isClientContext(ctx: SharedContextAPI): ctx is SharedContextAPI & ClientContextExtensions {
  return 'connect' in ctx && typeof (ctx as unknown as ClientContextExtensions).connect === 'function'
}
