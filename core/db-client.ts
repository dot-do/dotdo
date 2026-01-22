/**
 * @dotdo/core - DBClient Interface
 *
 * The unified database interface that all storage backends implement.
 * This provides a consistent API for CRUD, Query, Relationships, and Batch operations.
 */

import type {
  Thing,
  Relationship,
  CreateThingInput,
  CreateRelationshipInput,
  QueryOptions,
  SearchOptions,
  StorableData
} from './types'

// =============================================================================
// DBClient Interface
// =============================================================================

/**
 * DBClient - The unified database interface
 *
 * All storage backends implement this interface:
 * - @dotdo/db4 - Pure TypeScript columnar store
 * - @dotdo/postgres - PGlite WASM PostgreSQL
 * - @dotdo/sqlite - sql.js WASM SQLite
 * - @dotdo/mongo - MongoDB compatibility on PostgreSQL
 * - @dotdo/evodb - Columnar shredding for analytics
 *
 * @example
 * ```typescript
 * // Create a client
 * const db = createDB4Client(storage)
 *
 * // CRUD operations
 * const user = await db.create({
 *   ns: 'app',
 *   type: 'User',
 *   data: { name: 'Alice', email: 'alice@example.com' }
 * })
 *
 * // Query operations
 * const users = await db.find({
 *   type: 'User',
 *   where: { email: { $contains: '@example.com' } },
 *   orderBy: 'createdAt',
 *   order: 'desc'
 * })
 *
 * // Relationship operations
 * await db.relate({
 *   type: 'follows',
 *   from: user.url,
 *   to: otherUser.url
 * })
 * ```
 */
export interface DBClient<T extends StorableData = StorableData> {
  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Get a Thing by URL
   *
   * @param url - The full URL of the Thing
   * @returns The Thing or null if not found
   */
  get(url: string): Promise<Thing<T> | null>

  /**
   * Get a Thing by namespace/type/id
   *
   * @param ns - Namespace
   * @param type - Entity type
   * @param id - Entity ID
   * @returns The Thing or null if not found
   */
  getById(ns: string, type: string, id: string): Promise<Thing<T> | null>

  /**
   * Create a new Thing
   *
   * @param options - Creation options including ns, type, optional id, and data
   * @returns The created Thing with all fields populated
   */
  create(options: CreateThingInput<T>): Promise<Thing<T>>

  /**
   * Update an existing Thing
   *
   * @param url - The URL of the Thing to update
   * @param data - Partial data to merge with existing data
   * @returns The updated Thing
   * @throws If the Thing is not found
   */
  update(url: string, data: Partial<T>): Promise<Thing<T>>

  /**
   * Create or update a Thing
   *
   * If a Thing with the given ns/type/id exists, it will be updated.
   * Otherwise, a new Thing will be created.
   *
   * @param options - Upsert options (id is required for upsert)
   * @returns The created or updated Thing
   */
  upsert(options: Required<CreateThingInput<T>>): Promise<Thing<T>>

  /**
   * Delete a Thing
   *
   * @param url - The URL of the Thing to delete
   * @returns True if deleted, false if not found
   */
  delete(url: string): Promise<boolean>

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  /**
   * List Things with optional filtering
   *
   * @param options - Query options for filtering and pagination
   * @returns Array of matching Things
   */
  list(options?: QueryOptions): Promise<Thing<T>[]>

  /**
   * Find Things matching criteria
   *
   * @param options - Query options with required type or where clause
   * @returns Array of matching Things
   */
  find(options: QueryOptions): Promise<Thing<T>[]>

  /**
   * Search Things using text/semantic search
   *
   * @param options - Search options with query string
   * @returns Array of matching Things
   */
  search(options: SearchOptions): Promise<Thing<T>[]>

  /**
   * Count Things matching criteria
   *
   * @param options - Query options for filtering
   * @returns Number of matching Things
   */
  count(options?: QueryOptions): Promise<number>

  // ===========================================================================
  // Relationship Operations
  // ===========================================================================

  /**
   * Create a relationship between two Things
   *
   * @param options - Relationship creation options
   * @returns The created Relationship
   */
  relate(options: CreateRelationshipInput): Promise<Relationship>

  /**
   * Remove a relationship
   *
   * @param from - Source Thing URL
   * @param type - Relationship type
   * @param to - Target Thing URL
   * @returns True if removed, false if not found
   */
  unrelate(from: string, type: string, to: string): Promise<boolean>

  /**
   * Get related Things (outbound relationships)
   *
   * @param url - The URL of the source Thing
   * @param relationshipType - Optional filter by relationship type
   * @returns Array of related Things
   */
  related(url: string, relationshipType?: string): Promise<Thing<T>[]>

  /**
   * Get referencing Things (inbound relationships / backlinks)
   *
   * @param url - The URL of the target Thing
   * @param relationshipType - Optional filter by relationship type
   * @returns Array of Things that reference this Thing
   */
  references(url: string, relationshipType?: string): Promise<Thing<T>[]>

  /**
   * Get relationships for a Thing
   *
   * @param url - The URL of the Thing
   * @param type - Optional filter by relationship type
   * @param direction - Filter by direction ('from', 'to', or 'both')
   * @returns Array of Relationships
   */
  relationships(
    url: string,
    type?: string,
    direction?: 'from' | 'to' | 'both'
  ): Promise<Relationship[]>

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  /**
   * Get multiple Things by URL
   *
   * @param urls - Array of Thing URLs
   * @returns Map of URL to Thing (or null if not found)
   */
  batchGet(urls: string[]): Promise<Map<string, Thing<T> | null>>

  /**
   * Create multiple Things
   *
   * @param items - Array of creation options
   * @returns Array of created Things
   */
  batchCreate(items: CreateThingInput<T>[]): Promise<Thing<T>[]>

  /**
   * Update multiple Things
   *
   * @param items - Array of { url, data } pairs
   * @returns Array of updated Things
   */
  batchUpdate?(items: Array<{ url: string; data: Partial<T> }>): Promise<Thing<T>[]>

  /**
   * Delete multiple Things
   *
   * @param urls - Array of Thing URLs to delete
   * @returns Number of Things deleted
   */
  batchDelete?(urls: string[]): Promise<number>

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Close connection and cleanup resources
   *
   * Optional - not all backends require explicit cleanup.
   */
  close?(): Promise<void>
}

// =============================================================================
// Typed Client Helper
// =============================================================================

/**
 * TypedDBClient - A DBClient scoped to a specific type
 *
 * Provides a more ergonomic API for working with a single entity type.
 *
 * @example
 * ```typescript
 * interface User { name: string; email: string }
 *
 * const users: TypedDBClient<User> = db.typed('app', 'User')
 *
 * const alice = await users.create({ name: 'Alice', email: 'alice@example.com' })
 * const user = await users.get('user-123')
 * const all = await users.list({ orderBy: 'createdAt', order: 'desc' })
 * ```
 */
export interface TypedDBClient<T extends StorableData = StorableData> {
  /** Get by ID */
  get(id: string): Promise<Thing<T> | null>

  /** Create a new entity */
  create(data: T): Promise<Thing<T>>

  /** Update an entity */
  update(id: string, data: Partial<T>): Promise<Thing<T>>

  /** Delete an entity */
  delete(id: string): Promise<boolean>

  /** List entities */
  list(options?: Omit<QueryOptions, 'ns' | 'type'>): Promise<Thing<T>[]>

  /** Find entities */
  find(options: Omit<QueryOptions, 'ns' | 'type'>): Promise<Thing<T>[]>

  /** Count entities */
  count(options?: Omit<QueryOptions, 'ns' | 'type'>): Promise<number>
}

/**
 * Create a typed client from a DBClient
 *
 * @param db - The base DBClient
 * @param ns - Namespace to scope to
 * @param type - Type to scope to
 * @returns A TypedDBClient scoped to the given ns/type
 */
export function createTypedClient<T extends StorableData>(
  db: DBClient,
  ns: string,
  type: string
): TypedDBClient<T> {
  const buildUrl = (id: string) => `https://${ns}/${type}/${id}`

  return {
    get: (id) => db.getById(ns, type, id) as Promise<Thing<T> | null>,
    create: (data) => db.create({ ns, type, data }) as Promise<Thing<T>>,
    update: (id, data) => db.update(buildUrl(id), data) as Promise<Thing<T>>,
    delete: (id) => db.delete(buildUrl(id)),
    list: (options) => db.list({ ...options, ns, type }) as Promise<Thing<T>[]>,
    find: (options) => db.find({ ...options, ns, type }) as Promise<Thing<T>[]>,
    count: (options) => db.count({ ...options, ns, type })
  }
}
