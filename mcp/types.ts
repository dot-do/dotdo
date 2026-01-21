/**
 * Local type definitions for @dotdo/mcp
 *
 * These types define the minimal interfaces needed by MCP tools without
 * creating direct dependencies on @dotdo/do or @dotdo/db.
 *
 * This decoupling approach:
 * 1. Prevents bidirectional dependencies (do-7jse)
 * 2. Allows MCP to be used with any compatible store implementation
 * 3. Makes testing easier with mock implementations
 */

// ============================================================================
// Store Abstractions
// ============================================================================
// Minimal interfaces for store operations needed by MCP tools.
// Implementations can use @dotdo/db or any compatible store.

/**
 * JSON-safe value types for storable data
 */
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type StorableData = Record<string, JsonValue>

/**
 * Base Thing interface with system fields
 * Minimal interface for MCP search and fetch operations
 */
export interface Thing<T extends StorableData = StorableData> {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

/**
 * Base Relationship interface
 * Minimal interface for MCP fetch enrichments
 */
export interface Relationship {
  subject: string
  predicate: string
  object: string
  $createdAt: number
  [key: string]: unknown
}

/**
 * Base Event interface
 * Minimal interface for MCP fetch enrichments
 */
export interface Event<P = unknown> {
  $id: string
  type: string
  payload: P
  $timestamp: number
  source?: string
  correlationId?: string
}

/**
 * Minimal ThingsStore interface for MCP tools
 * Defines only the operations needed by search and fetch tools
 */
export interface ThingsStore {
  /** Get a single Thing by ID */
  get(id: string): Promise<Thing | null>

  /** List things with optional filtering */
  list(options?: { type?: string; limit?: number; offset?: number }): Promise<Thing[]>
}

/**
 * Minimal RelationshipsStore interface for MCP tools
 * Defines only the operations needed by fetch enrichment
 */
export interface RelationshipsStore {
  /** Find relationships matching a query */
  find(query: { subject?: string; predicate?: string; object?: string }): Promise<Relationship[]>
}

/**
 * Minimal EventsStore interface for MCP tools
 * Defines only the operations needed by fetch enrichment
 */
export interface EventsStore {
  /** Query events with filtering */
  query(options?: { source?: string; limit?: number }): Promise<Event[]>
}

// ============================================================================
// Query Builder Abstraction
// ============================================================================

/**
 * Fluent query builder interface for search operations
 * Compatible with @dotdo/db query() function
 */
export interface QueryBuilder {
  /** Filter by $type */
  type(typeName: string): QueryBuilder

  /** Filter by field values */
  where(conditions: StorableData): QueryBuilder

  /** Order results */
  orderBy(field: string, direction: 'asc' | 'desc'): QueryBuilder

  /** Select specific fields */
  select(...fields: string[]): QueryBuilder

  /** Limit results */
  limit(count: number): QueryBuilder

  /** Execute the query */
  execute(): Promise<Thing[]>
}

/**
 * Factory function type for creating query builders
 */
export type QueryFactory = (store: ThingsStore) => QueryBuilder

// ============================================================================
// WorkflowContext Types
// ============================================================================

/**
 * Options for $.do() durable action execution
 * Mirrors DoOptions from @dotdo/do
 */
export interface DoOptions {
  /** Number of retry attempts (default: 3) */
  retries?: number
  /** Backoff strategy: 'linear' or 'exponential' (default: 'exponential') */
  backoff?: 'linear' | 'exponential'
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * Minimal WorkflowContext interface for MCP sandbox operations.
 *
 * This defines only the methods actually used by the sandbox:
 * - send(): Fire-and-forget event emission
 * - try(): Single attempt action execution
 * - do(): Durable action execution with retries
 *
 * The full WorkflowContext from @dotdo/do includes additional features
 * (on, every, integrations, etc.) that the sandbox doesn't directly invoke.
 */
export interface WorkflowContext {
  /** Fire-and-forget event emission */
  send(event: { type: string; payload?: unknown }): void

  /** Single attempt (no retries) */
  try<T>(action: () => Promise<T>): Promise<T>

  /** Durable with retries */
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>
}
