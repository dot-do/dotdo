/**
 * @dotdo/core - Core Types
 *
 * Base types for the unified database abstraction layer.
 */

// =============================================================================
// JSON Types
// =============================================================================

/**
 * JSON primitive type - basic JSON values
 */
export type JsonPrimitive = string | number | boolean | null

/**
 * JSON array type
 */
export type JsonArray = JsonValue[]

/**
 * JSON value - any valid JSON value
 */
export type JsonValue =
  | JsonPrimitive
  | JsonArray
  | { [key: string]: JsonValue }

/**
 * JSON object - record with string keys and JSON values
 */
export type JsonObject = { [key: string]: JsonValue }

/**
 * Storable data constraint for generic types
 */
export type StorableData = Record<string, JsonValue>

// =============================================================================
// Thing (Node/Entity)
// =============================================================================

/**
 * Thing - A node in the database (linked data style)
 *
 * Things are the primary entities in the database. They have:
 * - A namespace (ns) for multi-tenancy
 * - A type for categorization
 * - A unique ID within namespace and type
 * - A URL that uniquely identifies the entity
 * - Timestamps for creation and updates
 * - User-defined data
 *
 * @example
 * ```typescript
 * const user: Thing<{ name: string; email: string }> = {
 *   ns: 'example.com',
 *   type: 'User',
 *   id: 'user-123',
 *   url: 'https://example.com/User/user-123',
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 *   data: { name: 'Alice', email: 'alice@example.com' }
 * }
 * ```
 */
export interface Thing<T extends StorableData = StorableData> {
  /** Namespace (e.g., 'example.com') - supports multi-tenancy */
  ns: string

  /** Entity type (e.g., 'User', 'Post', 'Function') */
  type: string

  /** Unique identifier within namespace and type */
  id: string

  /** Full URL for the entity (canonical identifier) */
  url: string

  /** When the entity was created */
  createdAt: Date

  /** When the entity was last updated */
  updatedAt: Date

  /** Entity data - user-defined properties */
  data: T
}

/**
 * Input for creating a Thing (excludes auto-generated fields)
 */
export interface CreateThingInput<T extends StorableData = StorableData> {
  /** Namespace for the entity */
  ns: string

  /** Entity type */
  type: string

  /** Optional ID (auto-generated if not provided) */
  id?: string

  /** Entity data */
  data: T
}

// =============================================================================
// Relationship (Edge)
// =============================================================================

/**
 * Relationship - An edge between two Things
 *
 * Relationships connect Things together with a type and optional data.
 * They are directional (from -> to) but can be queried in both directions.
 *
 * @example
 * ```typescript
 * const authorRel: Relationship = {
 *   id: 'rel-123',
 *   type: 'author',
 *   from: 'https://example.com/Post/post-1',
 *   to: 'https://example.com/User/user-123',
 *   createdAt: new Date()
 * }
 * ```
 */
export interface Relationship<T extends StorableData = StorableData> {
  /** Unique identifier for the relationship */
  id: string

  /** Relationship type (e.g., 'author', 'tags', 'likes') */
  type: string

  /** Source Thing URL */
  from: string

  /** Target Thing URL */
  to: string

  /** When the relationship was created */
  createdAt: Date

  /** Optional edge data (e.g., weight, metadata) */
  data?: T
}

/**
 * Input for creating a Relationship
 */
export interface CreateRelationshipInput<T extends StorableData = StorableData> {
  /** Relationship type */
  type: string

  /** Source Thing URL */
  from: string

  /** Target Thing URL */
  to: string

  /** Optional edge data */
  data?: T
}

// =============================================================================
// Query Options
// =============================================================================

/**
 * Query options for filtering and pagination
 */
export interface QueryOptions {
  /** Filter by namespace */
  ns?: string

  /** Filter by entity type */
  type?: string

  /** Where clause conditions */
  where?: Record<string, unknown>

  /** Field to order by */
  orderBy?: string

  /** Sort order */
  order?: 'asc' | 'desc'

  /** Maximum number of results */
  limit?: number

  /** Number of results to skip */
  offset?: number
}

/**
 * Search options for text/semantic search
 */
export interface SearchOptions {
  /** Search query string */
  query: string

  /** Fields to search in */
  fields?: string[]

  /** Maximum number of results */
  limit?: number
}

// =============================================================================
// Type Hierarchies (Polymorphic Collections)
// =============================================================================

/**
 * Schema definition with inheritance support
 *
 * Use $extends to inherit from a parent type.
 * Use $abstract to mark a type that cannot be instantiated directly.
 */
export interface TypeSchema {
  /** Type name */
  $type: string

  /** Parent type to inherit from */
  $extends?: string

  /** Whether this type is abstract (cannot be instantiated) */
  $abstract?: boolean

  /** Index definitions */
  $index?: string[][]

  /** Field definitions */
  [field: string]: unknown
}

/**
 * Discriminated union helper - data with $type discriminator
 *
 * Used for polymorphic collections where sub-types are stored together.
 */
export interface Discriminated<T extends string = string> {
  /** Type discriminator */
  $type: T
}

// =============================================================================
// Pagination Results
// =============================================================================

/**
 * Paginated result with offset-based pagination
 */
export interface PaginatedResult<T> {
  /** Result items */
  items: T[]

  /** Total count of matching items */
  total: number

  /** Number of items skipped */
  offset: number

  /** Maximum items per page */
  limit: number

  /** Whether there are more results */
  hasMore: boolean
}

/**
 * Cursor-based pagination result
 */
export interface CursorResult<T> {
  /** Result items */
  items: T[]

  /** Cursor for the next page */
  cursor?: string

  /** Whether there are more results */
  hasMore: boolean
}
