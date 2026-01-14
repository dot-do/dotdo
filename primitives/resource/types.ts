/**
 * Resource Type Definitions
 *
 * Type definitions for the unified Resource abstraction.
 */

// =============================================================================
// Query DSL Types
// =============================================================================

/**
 * Query operators for filtering resources
 */
export interface QueryOperators<T> {
  eq?: T
  ne?: T
  gt?: T
  lt?: T
  gte?: T
  lte?: T
  in?: T[]
  nin?: T[]
  contains?: string
  startsWith?: string
  endsWith?: string
}

/**
 * Query type for filtering resources
 * Each field can have query operators applied
 */
export type Query<T> = {
  [K in keyof T]?: T[K] | QueryOperators<T[K]>
}

// =============================================================================
// Change Events
// =============================================================================

/**
 * Types of changes that can occur on a resource
 */
export type ChangeType = 'create' | 'update' | 'delete'

/**
 * Change event emitted when a resource is modified
 */
export interface ChangeEvent<T> {
  type: ChangeType
  id: string
  data?: T
  previousData?: T
  timestamp: Date
}

// =============================================================================
// Schema Types
// =============================================================================

/**
 * Field types supported by the schema
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'

/**
 * Field definition in a resource schema
 */
export interface FieldDefinition {
  type: FieldType
  required?: boolean
  unique?: boolean
  indexed?: boolean
  default?: unknown
}

/**
 * Schema definition for a resource
 */
export type ResourceSchema<T> = {
  [K in keyof T]: FieldDefinition
}

// =============================================================================
// Resource Interface
// =============================================================================

/**
 * Base entity type - all resources must have an id
 */
export interface Entity {
  id: string
}

/**
 * Resource interface - unified CRUD + Query interface
 */
export interface Resource<T extends Entity, TQuery = Query<T>> {
  // CRUD
  create(data: Omit<T, 'id'>): Promise<T>
  get(id: string): Promise<T | null>
  update(id: string, patch: Partial<T>): Promise<T>
  delete(id: string): Promise<void>

  // Query (chainable, returns AsyncIterable)
  find(query?: TQuery): AsyncIterable<T>
  findOne(query?: TQuery): Promise<T | null>
  count(query?: TQuery): Promise<number>

  // Batch
  bulkCreate(items: Omit<T, 'id'>[]): Promise<T[]>
  bulkUpdate(filter: TQuery, patch: Partial<T>): Promise<number>
  bulkDelete(filter: TQuery): Promise<number>

  // Watch (change streams)
  watch(query?: TQuery): AsyncIterable<ChangeEvent<T>>

  // Schema
  schema(): ResourceSchema<T>
}

// =============================================================================
// Storage Backend Interface
// =============================================================================

/**
 * Storage backend interface - pluggable storage for Resource implementations
 *
 * This interface allows Resource to work with different storage backends:
 * - In-memory (for testing)
 * - D1 (Cloudflare SQL)
 * - DO State (Durable Object storage)
 * - SQLite
 * - Postgres
 */
export interface StorageBackend<T extends Entity> {
  // Basic CRUD
  set(id: string, data: T): Promise<void>
  get(id: string): Promise<T | null>
  delete(id: string): Promise<boolean>
  has(id: string): Promise<boolean>

  // Iteration
  values(): AsyncIterable<T>
  entries(): AsyncIterable<[string, T]>

  // Bulk operations
  clear(): Promise<void>
  size(): Promise<number>
}

/**
 * In-memory storage backend implementation
 */
export class MemoryStorageBackend<T extends Entity> implements StorageBackend<T> {
  private store: Map<string, T> = new Map()

  async set(id: string, data: T): Promise<void> {
    this.store.set(id, data)
  }

  async get(id: string): Promise<T | null> {
    return this.store.get(id) ?? null
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id)
  }

  async has(id: string): Promise<boolean> {
    return this.store.has(id)
  }

  async *values(): AsyncIterable<T> {
    for (const value of this.store.values()) {
      yield value
    }
  }

  async *entries(): AsyncIterable<[string, T]> {
    for (const entry of this.store.entries()) {
      yield entry
    }
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  async size(): Promise<number> {
    return this.store.size
  }
}
