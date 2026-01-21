/**
 * Store Abstraction Layer for @dotdo/mcp
 *
 * This module provides abstract store interfaces that decouple MCP tools from
 * specific storage implementations. Any store implementation that satisfies
 * these interfaces can be used with MCP tools.
 *
 * ## Design Goals (do-7jse)
 *
 * 1. **No Direct Dependencies**: MCP tools import only from this file, never
 *    directly from @dotdo/db or other store implementations.
 *
 * 2. **Dependency Injection**: All tools accept stores via factory functions
 *    (e.g., `createSearchTool({ store })`) rather than importing them.
 *
 * 3. **Store Adapter Pattern**: Any storage backend can be used by implementing
 *    the minimal interfaces defined here.
 *
 * 4. **Testability**: Mock implementations are trivial to create since
 *    interfaces define only the required operations.
 *
 * ## Usage Examples
 *
 * ### With @dotdo/db (recommended for production)
 * ```typescript
 * import { createSearchTool, createFetchTool } from '@dotdo/mcp'
 * import { createThingsStore, createRelationshipsStore, createEventsStore } from '@dotdo/db'
 *
 * const things = createThingsStore(storage)
 * const relationships = createRelationshipsStore(storage)
 * const events = createEventsStore(storage)
 *
 * const searchTool = createSearchTool({ store: things })
 * const fetchTool = createFetchTool({ things, relationships, events })
 * ```
 *
 * ### With custom adapter
 * ```typescript
 * import { createSearchTool, type ThingsStore } from '@dotdo/mcp'
 *
 * // Create adapter for your storage backend
 * const myAdapter: ThingsStore = {
 *   async get(id) { return myDb.findById(id) },
 *   async list(opts) { return myDb.query(opts) }
 * }
 *
 * const searchTool = createSearchTool({ store: myAdapter })
 * ```
 *
 * ### With mock for testing
 * ```typescript
 * import { createSearchTool, type ThingsStore } from '@dotdo/mcp'
 *
 * const mockStore: ThingsStore = {
 *   async get(id) { return testData.find(t => t.$id === id) ?? null },
 *   async list(opts) { return testData.filter(t => !opts?.type || t.$type === opts.type) }
 * }
 *
 * const searchTool = createSearchTool({ store: mockStore })
 * ```
 *
 * @module @dotdo/mcp/types
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

// ============================================================================
// Store Adapter Utilities
// ============================================================================

/**
 * Combined store dependencies for fetch tool.
 *
 * This interface groups all stores needed by the fetch tool,
 * making dependency injection cleaner.
 *
 * @example
 * ```typescript
 * const stores: StoreAdapter = {
 *   things: createThingsStore(storage),
 *   relationships: createRelationshipsStore(storage),
 *   events: createEventsStore(storage)
 * }
 *
 * const fetchTool = createFetchTool(stores)
 * ```
 */
export interface StoreAdapter {
  things: ThingsStore
  relationships: RelationshipsStore
  events: EventsStore
}

/**
 * Create a no-op workflow context for testing.
 *
 * This provides a minimal implementation that satisfies the WorkflowContext
 * interface without any side effects. Useful for unit testing MCP tools
 * that require a context but don't need real workflow execution.
 *
 * @returns A mock WorkflowContext that captures operations but performs no actions
 *
 * @example
 * ```typescript
 * import { createMockContext, createSandboxTool } from '@dotdo/mcp'
 *
 * const mockContext = createMockContext()
 * const sandboxTool = createSandboxTool({ context: mockContext })
 *
 * // Execute code in sandbox
 * const result = await sandboxTool.execute({ code: '$.send({ type: "test" })' })
 *
 * // Check captured operations
 * console.log(mockContext.captured) // [{ op: 'send', event: { type: 'test' } }]
 * ```
 */
export function createMockContext(): WorkflowContext & { captured: Array<{ op: string; data: unknown }> } {
  const captured: Array<{ op: string; data: unknown }> = []

  return {
    captured,

    send(event) {
      captured.push({ op: 'send', data: event })
    },

    async try<T>(action: () => Promise<T>): Promise<T> {
      const result = await action()
      captured.push({ op: 'try', data: result })
      return result
    },

    async do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T> {
      const result = await action()
      captured.push({ op: 'do', data: { result, options } })
      return result
    }
  }
}

/**
 * Create a mock ThingsStore for testing.
 *
 * This provides an in-memory implementation of ThingsStore that can be
 * pre-populated with test data. Useful for testing MCP tools without
 * requiring a real database.
 *
 * @param initialData - Optional array of Things to populate the store
 * @returns A mock ThingsStore backed by in-memory array
 *
 * @example
 * ```typescript
 * import { createMockThingsStore, createSearchTool } from '@dotdo/mcp'
 *
 * const store = createMockThingsStore([
 *   { $id: '1', $type: 'User', $createdAt: Date.now(), $updatedAt: Date.now(), name: 'Alice' },
 *   { $id: '2', $type: 'User', $createdAt: Date.now(), $updatedAt: Date.now(), name: 'Bob' }
 * ])
 *
 * const searchTool = createSearchTool({ store })
 * const results = await searchTool.execute({ $type: 'User' })
 * ```
 */
export function createMockThingsStore(initialData: Thing[] = []): ThingsStore {
  const data = [...initialData]

  return {
    async get(id: string): Promise<Thing | null> {
      return data.find(t => t.$id === id) ?? null
    },

    async list(options?: { type?: string; limit?: number; offset?: number }): Promise<Thing[]> {
      let result = data

      if (options?.type) {
        result = result.filter(t => t.$type === options.type)
      }

      const offset = options?.offset ?? 0
      const limit = options?.limit ?? result.length

      return result.slice(offset, offset + limit)
    }
  }
}

/**
 * Create a mock RelationshipsStore for testing.
 *
 * @param initialData - Optional array of Relationships to populate the store
 * @returns A mock RelationshipsStore backed by in-memory array
 */
export function createMockRelationshipsStore(initialData: Relationship[] = []): RelationshipsStore {
  const data = [...initialData]

  return {
    async find(query: { subject?: string; predicate?: string; object?: string }): Promise<Relationship[]> {
      return data.filter(r => {
        if (query.subject && r.subject !== query.subject) return false
        if (query.predicate && r.predicate !== query.predicate) return false
        if (query.object && r.object !== query.object) return false
        return true
      })
    }
  }
}

/**
 * Create a mock EventsStore for testing.
 *
 * @param initialData - Optional array of Events to populate the store
 * @returns A mock EventsStore backed by in-memory array
 */
export function createMockEventsStore(initialData: Event[] = []): EventsStore {
  const data = [...initialData]

  return {
    async query(options?: { source?: string; limit?: number }): Promise<Event[]> {
      let result = data

      if (options?.source) {
        result = result.filter(e => e.source === options.source)
      }

      const limit = options?.limit ?? result.length
      return result.slice(0, limit)
    }
  }
}
