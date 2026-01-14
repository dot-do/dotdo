/**
 * @module db/stores
 *
 * Store Accessors for DO Base Class - the primary data access layer.
 *
 * This module provides typed store classes that encapsulate all database operations
 * for Durable Objects. Each store manages a specific domain of data with consistent
 * APIs, error handling, and real-time sync support.
 *
 * ## Store Types
 *
 * | Store | Purpose | Key Operations |
 * |-------|---------|----------------|
 * | ThingsStore | Versioned entities | get, list, create, update, delete, versions |
 * | RelationshipsStore | Entity connections | create, list, delete, from, to |
 * | ActionsStore | Action logging | log, complete, fail, retry, pending |
 * | EventsStore | Event emission | emit, stream, replay, list |
 * | SearchStore | Full-text search | index, query, semantic, remove |
 * | ObjectsStore | DO registry | register, resolve, shards, primary |
 * | DLQStore | Dead letter queue | add, replay, replayAll, purge |
 *
 * ## Usage Pattern
 *
 * Stores are instantiated with a StoreContext that provides database access,
 * namespace info, and environment bindings:
 *
 * @example Creating stores in a Durable Object
 * ```ts
 * class MyDO extends DOBase {
 *   private things: ThingsStore
 *   private events: EventsStore
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *     const ctx: StoreContext = {
 *       db: this.db,
 *       ns: this.ns,
 *       currentBranch: 'main',
 *       env,
 *       typeCache: new Map(),
 *     }
 *     this.things = new ThingsStore(ctx)
 *     this.events = new EventsStore(ctx)
 *   }
 * }
 * ```
 *
 * @example CRUD operations with ThingsStore
 * ```ts
 * // Create a new entity
 * const user = await things.create({
 *   $type: 'User',
 *   name: 'John Doe',
 *   data: { email: 'john@example.com' },
 * })
 *
 * // Update with merge
 * await things.update(user.$id, {
 *   data: { role: 'admin' },
 * }, { merge: true })
 *
 * // Soft delete
 * await things.delete(user.$id)
 *
 * // List all users
 * const users = await things.list({ type: 'User' })
 * ```
 *
 * @example Real-time sync with mutation callbacks
 * ```ts
 * things.onMutation = (type, thing, rowid) => {
 *   syncEngine.broadcast({
 *     type: `thing:${type}`,
 *     data: thing,
 *     version: rowid,
 *   })
 * }
 * ```
 *
 * @see {@link things.ts} for the underlying table schema
 * @see {@link DOBase} for how stores integrate with Durable Objects
 */

import { eq, and, or, desc, asc, isNull, sql } from 'drizzle-orm'
import type { DODatabase, AppSchema } from '../types/drizzle'
import * as schema from '../db'
import { logBestEffortError } from '../lib/logging/error-logger'
import { safeJsonParse } from '../lib/safe-stringify'
import { event as createEvent, type Pipeline } from '../lib/events'

// ============================================================================
// SQL INJECTION PREVENTION
// ============================================================================

/**
 * Whitelist of columns allowed for orderBy in ThingsStore.list().
 *
 * These are the only column names that can be used in ORDER BY clauses.
 * Any other value will throw an error, preventing SQL injection attacks.
 *
 * @example Valid ordering
 * ```ts
 * // These work
 * await things.list({ orderBy: 'id' })
 * await things.list({ orderBy: 'name', order: 'desc' })
 *
 * // This throws an error
 * await things.list({ orderBy: 'data; DROP TABLE things;--' })
 * // Error: Invalid order column
 * ```
 */
export const ALLOWED_ORDER_COLUMNS = Object.freeze([
  'id',
  'name',
  'type',
  'branch',
  'deleted',
] as const)

/** Type representing a valid ORDER BY column name */
export type AllowedOrderColumn = typeof ALLOWED_ORDER_COLUMNS[number]

/**
 * Validates that an orderBy column name is in the allowed whitelist.
 *
 * This is a security function that prevents SQL injection by ensuring
 * only whitelisted column names can be used in dynamic ORDER BY clauses.
 *
 * @param column - The column name to validate
 * @returns The validated column name (type-narrowed to AllowedOrderColumn)
 * @throws Error if the column is not in the whitelist
 *
 * @example
 * ```ts
 * const safeColumn = validateOrderColumn('name') // OK
 * const malicious = validateOrderColumn('id; DROP TABLE') // Throws!
 * ```
 */
export function validateOrderColumn(column: string): AllowedOrderColumn {
  if (!column || typeof column !== 'string') {
    throw new Error('Invalid order column: column name is required')
  }

  // Check against whitelist
  if (!ALLOWED_ORDER_COLUMNS.includes(column as AllowedOrderColumn)) {
    throw new Error(
      `Invalid order column: '${column}'. Allowed columns: ${ALLOWED_ORDER_COLUMNS.join(', ')}`
    )
  }

  return column as AllowedOrderColumn
}

/**
 * Regular expression for valid JSON paths.
 *
 * Only allows alphanumeric characters, underscores, and dots (for nested paths).
 * Rejects SQL metacharacters and invalid path patterns.
 *
 * Valid: `status`, `config.enabled`, `user_id`
 * Invalid: `.status`, `config..enabled`, `data; DROP TABLE`
 */
const VALID_JSON_PATH_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/

/**
 * Validates that a JSON path is safe for use in SQL queries.
 *
 * This security function ensures JSON paths used in json_extract() calls
 * cannot contain SQL injection payloads. Paths must:
 * - Start with a letter or underscore
 * - Contain only alphanumeric, underscore, and dot characters
 * - Not have consecutive, leading, or trailing dots
 *
 * @param path - The JSON path to validate
 * @returns The validated JSON path
 * @throws Error if the path contains invalid characters
 *
 * @example
 * ```ts
 * validateJsonPath('status')        // OK: 'status'
 * validateJsonPath('config.enabled') // OK: 'config.enabled'
 * validateJsonPath('.bad')          // Throws: starts with dot
 * validateJsonPath('a; DROP')       // Throws: contains semicolon
 * ```
 */
export function validateJsonPath(path: string): string {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid JSON path: path is required')
  }

  if (!VALID_JSON_PATH_REGEX.test(path)) {
    throw new Error(
      `Invalid JSON path: '${path}'. JSON paths must contain only alphanumeric characters, underscores, and dots for nesting.`
    )
  }

  return path
}

// ============================================================================
// TYPE-SAFE QUERY BUILDERS
// ============================================================================

/**
 * Type-safe ORDER BY clause builder lookup table.
 *
 * Pre-built SQL fragments for each column/direction combination.
 * This approach completely eliminates the need for sql.raw() by using
 * a static lookup table - no dynamic SQL construction at runtime.
 *
 * @internal Used by buildOrderClause()
 */
const ORDER_CLAUSE_BUILDERS = {
  id: {
    asc: sql`ORDER BY t.id ASC`,
    desc: sql`ORDER BY t.id DESC`,
  },
  name: {
    asc: sql`ORDER BY t.name ASC`,
    desc: sql`ORDER BY t.name DESC`,
  },
  type: {
    asc: sql`ORDER BY t.type ASC`,
    desc: sql`ORDER BY t.type DESC`,
  },
  branch: {
    asc: sql`ORDER BY t.branch ASC`,
    desc: sql`ORDER BY t.branch DESC`,
  },
  deleted: {
    asc: sql`ORDER BY t.deleted ASC`,
    desc: sql`ORDER BY t.deleted DESC`,
  },
} as const

/**
 * Builds a type-safe ORDER BY clause without using sql.raw().
 *
 * Uses pre-defined SQL fragments looked up by validated column name.
 * This is the recommended way to add dynamic ordering to queries.
 *
 * @param column - The validated column name (must be in ALLOWED_ORDER_COLUMNS)
 * @param direction - The sort direction ('asc' or 'desc'), defaults to 'asc'
 * @returns A safe SQL fragment for the ORDER BY clause
 *
 * @example
 * ```ts
 * const orderClause = buildOrderClause('name', 'desc')
 * const query = sql`SELECT * FROM things ${orderClause}`
 * ```
 */
export function buildOrderClause(
  column: AllowedOrderColumn,
  direction: 'asc' | 'desc' = 'asc'
) {
  return ORDER_CLAUSE_BUILDERS[column][direction]
}

/**
 * Builds a safe JSON path string for use with SQLite json_extract().
 *
 * Prepends `$.` to the validated path to create a valid SQLite JSON path.
 * The path is validated against a strict regex before building.
 *
 * ## Security
 *
 * The validation ensures:
 * - Path starts with letter or underscore
 * - Contains only alphanumeric chars, underscores, and dots
 * - No consecutive dots, no leading/trailing dots
 * - No SQL metacharacters (quotes, semicolons, parentheses, etc.)
 *
 * The resulting path is used as a parameterized value (not raw SQL),
 * which is safe because SQLite's json_extract() only interprets it
 * as a JSON path selector.
 *
 * @param path - The JSON path to build (e.g., 'status', 'config.enabled')
 * @returns The full SQLite JSON path (e.g., '$.status', '$.config.enabled')
 *
 * @example
 * ```ts
 * const jsonPath = buildSafeJsonPath('config.enabled')
 * // Returns: '$.config.enabled'
 *
 * const query = sql`json_extract(data, ${jsonPath})`
 * ```
 */
export function buildSafeJsonPath(path: string): string {
  const validated = validateJsonPath(path)
  return `$.${validated}`
}

/**
 * Builds a type-safe JSON extract condition using parameterized binding.
 *
 * Creates a SQL condition for filtering on JSON data fields using
 * SQLite's json_extract() function.
 *
 * ## Security
 *
 * Uses buildSafeJsonPath() which validates the path against a strict regex.
 * Both path and value are parameterized, preventing SQL injection.
 *
 * @param path - The JSON path to validate and use (e.g., 'status', 'config.enabled')
 * @param value - The value to compare against (will be JSON stringified and parameterized)
 * @returns A safe SQL fragment for the JSON extract condition
 *
 * @example
 * ```ts
 * // Filter things where data.status = 'active'
 * const condition = buildJsonCondition('status', 'active')
 * // Produces: json_extract(t.data, '$.status') = '"active"'
 *
 * // Use in a query
 * const query = sql`SELECT * FROM things t WHERE ${condition}`
 * ```
 */
export function buildJsonCondition(path: string, value: unknown) {
  const safePath = buildSafeJsonPath(path)
  return sql`json_extract(t.data, ${safePath}) = ${JSON.stringify(value)}`
}

// ============================================================================
// THING TYPES
// ============================================================================

/**
 * Entity representation of a Thing for store operations.
 *
 * This is the application-level representation used by ThingsStore,
 * with semantic field names ($id, $type) rather than database column names.
 *
 * @example
 * ```ts
 * const user: ThingEntity = {
 *   $id: 'user-123',
 *   $type: 'User',
 *   name: 'John Doe',
 *   data: { email: 'john@example.com', role: 'admin' },
 *   version: 5,
 *   deleted: false,
 * }
 * ```
 */
export interface ThingEntity {
  $id: string
  $type: string
  name?: string | null
  data?: Record<string, unknown> | null
  branch?: string | null
  version?: number
  deleted?: boolean
}

/**
 * Options for ThingsStore.get() method.
 *
 * @example Get specific version
 * ```ts
 * const v3 = await things.get('doc-123', { version: 3 })
 * ```
 *
 * @example Get on branch including deleted
 * ```ts
 * const staging = await things.get('config', {
 *   branch: 'staging',
 *   includeDeleted: true,
 * })
 * ```
 */
export interface ThingsGetOptions {
  /** Branch to read from (default: current branch) */
  branch?: string
  /** Specific version number to retrieve (for time travel) */
  version?: number
  /** Include soft-deleted things (default: false) */
  includeDeleted?: boolean
}

/**
 * Options for ThingsStore.list() method.
 *
 * Provides filtering, pagination, ordering, and JSON field queries.
 *
 * @example Paginated list with type filter
 * ```ts
 * const users = await things.list({
 *   type: 'User',
 *   orderBy: 'name',
 *   order: 'asc',
 *   limit: 20,
 *   offset: 0,
 * })
 * ```
 *
 * @example Cursor-based pagination
 * ```ts
 * const page1 = await things.list({ limit: 20 })
 * const lastId = page1[page1.length - 1]?.$id
 * const page2 = await things.list({ limit: 20, after: lastId })
 * ```
 *
 * @example JSON field filter
 * ```ts
 * const activeUsers = await things.list({
 *   type: 'User',
 *   where: { 'data.status': 'active' },
 * })
 * ```
 */
export interface ThingsListOptions {
  /** Filter by type name (e.g., 'User', 'Document') */
  type?: string
  /** Branch to list from (default: current branch) */
  branch?: string
  /** Column to order by (must be in ALLOWED_ORDER_COLUMNS) */
  orderBy?: string
  /** Sort direction */
  order?: 'asc' | 'desc'
  /** Maximum number of results (default: 100) */
  limit?: number
  /** Number of results to skip (for offset pagination) */
  offset?: number
  /** Cursor for cursor-based pagination (return items after this ID) */
  after?: string
  /** Include soft-deleted things (default: false) */
  includeDeleted?: boolean
  /** JSON field filters (e.g., { 'data.status': 'active' }) */
  where?: Record<string, unknown>
}

export interface ThingsCreateOptions {
  branch?: string
}

export interface ThingsUpdateOptions {
  merge?: boolean
  branch?: string
}

export interface ThingsDeleteOptions {
  hard?: boolean
  branch?: string
}

// ============================================================================
// RELATIONSHIP TYPES
// ============================================================================

export interface RelationshipEntity {
  id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown> | null
  createdAt: Date
}

export interface RelationshipsListOptions {
  from?: string
  to?: string
  verb?: string
  limit?: number
  offset?: number
}

export interface RelationshipsTraversalOptions {
  verb?: string
}

// ============================================================================
// ACTION TYPES
// ============================================================================

export interface ActionEntity {
  id: string
  verb: string
  actor?: string | null
  target: string
  input?: number | Record<string, unknown> | null
  output?: number | Record<string, unknown> | null
  options?: Record<string, unknown> | null
  durability: 'send' | 'try' | 'do'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'undone' | 'retrying'
  error?: Record<string, unknown> | null
  requestId?: string | null
  sessionId?: string | null
  workflowId?: string | null
  createdAt: Date
  startedAt?: Date | null
  completedAt?: Date | null
  duration?: number | null
  retryCount?: number
}

export interface ActionsLogOptions {
  verb: string
  target: string
  actor?: string
  input?: number | Record<string, unknown>
  output?: number
  durability?: 'send' | 'try' | 'do'
  requestId?: string
  sessionId?: string
  workflowId?: string
}

export interface ActionsListOptions {
  target?: string
  actor?: string
  status?: string
  verb?: string
}

// ============================================================================
// EVENT TYPES
// ============================================================================

export interface EventEntity {
  id: string
  verb: string
  source: string
  data: Record<string, unknown>
  actionId?: string | null
  sequence: number
  streamed: boolean
  streamedAt?: Date | null
  createdAt: Date
}

export interface EventsEmitOptions {
  verb: string
  source: string
  data: Record<string, unknown>
  actionId?: string
}

export interface EventsListOptions {
  source?: string
  verb?: string
  afterSequence?: number
  orderBy?: string
  order?: 'asc' | 'desc'
}

export interface EventsReplayOptions {
  fromSequence: number
  limit?: number
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

export interface SearchEntry {
  $id: string
  $type: string
  content: string
  embedding?: Buffer | null
  embeddingDim?: number
  indexedAt: Date
}

export interface SearchResult extends SearchEntry {
  score: number
}

export interface SearchQueryOptions {
  type?: string
  limit?: number
}

// ============================================================================
// OBJECTS TYPES
// ============================================================================

export interface DOObjectEntity {
  ns: string
  id: string
  class: string
  relation?: string | null
  shardKey?: string | null
  shardIndex?: number | null
  region?: string | null
  colo?: string | null
  primary?: boolean | null
  cached?: Record<string, unknown> | null
  createdAt: Date
}

export interface ObjectsRegisterOptions {
  ns: string
  id: string
  class: string
  relation?: string
  shardKey?: string
  shardIndex?: number
  region?: string
  colo?: string
  primary?: boolean
}

export interface ObjectsCreateOptions {
  ns: string
  doId: string
  doClass: string
  relation?: string
  shardKey?: string
  shardIndex?: number
  region?: string
  colo?: string
  primary?: boolean
}

export interface ObjectsListOptions {
  relation?: string
  class?: string
  region?: string
  colo?: string
}

// ============================================================================
// STORE CONTEXT
// ============================================================================

/**
 * Context required by all store classes.
 *
 * Provides database access, namespace identification, and environment bindings
 * needed for store operations. Typically created once per Durable Object and
 * shared across all stores.
 *
 * @example Creating a store context
 * ```ts
 * const ctx: StoreContext = {
 *   db: drizzle(state.storage.sql) as DODatabase<AppSchema>,
 *   ns: 'tenant-123',
 *   currentBranch: 'main',
 *   env: {
 *     DO: env.DO,
 *     EVENTS: env.EVENTS,
 *   },
 *   typeCache: new Map(),
 * }
 *
 * const things = new ThingsStore(ctx)
 * const events = new EventsStore(ctx)
 * ```
 */
export interface StoreContext {
  /** Drizzle database instance with app schema */
  db: DODatabase<AppSchema>
  /** Namespace identifier (tenant, org, or DO name) */
  ns: string
  /** Current branch for read/write operations */
  currentBranch: string
  /** Environment bindings for CF services */
  env: {
    DO?: {
      idFromName(name: string): { toString(): string }
      idFromString(id: string): { toString(): string }
      get(id: { toString(): string }): { fetch(request: Request): Promise<Response> }
    }
    EVENTS?: Pipeline
    AI?: { fetch(request: Request): Promise<Response> }
    /** R2 SQL binding for global object registry (cross-DO resolution fallback) */
    R2_SQL?: {
      exec(query: string, params: unknown[]): Promise<{ results: unknown[] }>
    }
  }
  typeCache: Map<string, number>
}

// ============================================================================
// THINGS STORE
// ============================================================================

/**
 * Mutation callback type for ThingsStore.
 *
 * Called after successful create, update, or delete operations.
 * Use this to implement real-time sync, audit logging, or cache invalidation.
 *
 * @param type - The mutation type: 'insert', 'update', or 'delete'
 * @param thing - The affected ThingEntity
 * @param rowid - The version number (SQLite rowid) of the new version
 *
 * @example Real-time sync broadcast
 * ```ts
 * things.onMutation = (type, thing, rowid) => {
 *   syncEngine.broadcast({
 *     channel: `things:${thing.$type}`,
 *     event: type,
 *     data: thing,
 *     version: rowid,
 *   })
 * }
 * ```
 */
export type ThingsMutationCallback = (
  type: 'insert' | 'update' | 'delete',
  thing: ThingEntity,
  rowid: number
) => void

/**
 * ThingsStore - CRUD operations for versioned entities.
 *
 * The primary store for managing Things in a Durable Object. Provides
 * typed operations for creating, reading, updating, and deleting Things
 * with automatic versioning, branch support, and real-time sync hooks.
 *
 * ## Key Features
 *
 * - **Versioning**: All mutations append new versions (never overwrite)
 * - **Branching**: Read/write from specific branches
 * - **Type caching**: Efficient noun type lookups with in-memory cache
 * - **Mutation callbacks**: Hook for real-time sync broadcasts
 * - **Soft delete**: Delete creates a new version with deleted=true
 *
 * @example Basic CRUD operations
 * ```ts
 * const things = new ThingsStore(ctx)
 *
 * // Create
 * const user = await things.create({
 *   $type: 'User',
 *   name: 'John',
 *   data: { email: 'john@example.com' },
 * })
 *
 * // Read
 * const fetched = await things.get(user.$id)
 *
 * // Update (merge by default)
 * await things.update(user.$id, {
 *   data: { role: 'admin' },
 * })
 *
 * // Delete (soft delete)
 * await things.delete(user.$id)
 *
 * // List with filters
 * const users = await things.list({ type: 'User' })
 *
 * // Get version history
 * const versions = await things.versions(user.$id)
 * ```
 */
export class ThingsStore {
  /**
   * Callback invoked after mutations (create, update, delete).
   * Set this to wire up real-time sync broadcasts via SyncEngine.
   */
  onMutation?: ThingsMutationCallback

  constructor(private ctx: StoreContext) {}

  private async getTypeId(typeName: string): Promise<number> {
    // Check cache first
    if (this.ctx.typeCache.has(typeName)) {
      return this.ctx.typeCache.get(typeName)!
    }

    // Look up or create the noun type
    const existing = await this.ctx.db
      .select()
      .from(schema.nouns)
      .where(eq(schema.nouns.noun, typeName))
      .limit(1)

    if (existing.length > 0) {
      // Get rowid by re-querying with raw SQL
      const result = await this.ctx.db.all(
        sql`SELECT rowid FROM nouns WHERE noun = ${typeName} LIMIT 1`
      )
      const rowid = (result as unknown[])[0] as { rowid: number } | undefined
      const id = rowid?.rowid ?? 0
      this.ctx.typeCache.set(typeName, id)
      return id
    }

    // Create new noun
    await this.ctx.db.insert(schema.nouns).values({
      noun: typeName,
      plural: typeName + 's',
    })

    // Get its rowid
    const result = await this.ctx.db.all(
      sql`SELECT rowid FROM nouns WHERE noun = ${typeName} LIMIT 1`
    )
    const rowid = (result as unknown[])[0] as { rowid: number } | undefined
    const id = rowid?.rowid ?? 0
    this.ctx.typeCache.set(typeName, id)
    return id
  }

  // Reverse cache: typeId -> typeName (for efficient lookup by ID)
  private typeCacheById: Map<number, string> = new Map()

  private async getTypeName(typeId: number): Promise<string> {
    // Check reverse cache first (O(1) lookup)
    if (this.typeCacheById.has(typeId)) {
      return this.typeCacheById.get(typeId)!
    }

    // Fall back to forward cache scan (for backwards compatibility)
    for (const [name, id] of Array.from(this.ctx.typeCache.entries())) {
      if (id === typeId) {
        // Populate reverse cache for future lookups
        this.typeCacheById.set(typeId, name)
        return name
      }
    }

    // Query the database
    const result = await this.ctx.db.all(
      sql`SELECT noun FROM nouns WHERE rowid = ${typeId} LIMIT 1`
    )
    const row = (result as unknown[])[0] as { noun: string } | undefined
    const name = row?.noun ?? 'Unknown'

    // Populate both caches
    this.ctx.typeCache.set(name, typeId)
    this.typeCacheById.set(typeId, name)

    return name
  }

  /**
   * Batch lookup type names for multiple type IDs.
   * This is the key optimization to avoid N+1 queries.
   *
   * @param typeIds - Array of type IDs to look up
   * @returns Map of typeId -> typeName
   */
  private async batchGetTypeNames(typeIds: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>()

    if (typeIds.length === 0) {
      return result
    }

    // Deduplicate type IDs
    const uniqueTypeIds = [...new Set(typeIds)]

    // Check cache first for each ID
    const uncachedIds: number[] = []
    for (const typeId of uniqueTypeIds) {
      if (this.typeCacheById.has(typeId)) {
        result.set(typeId, this.typeCacheById.get(typeId)!)
      } else {
        // Check forward cache
        let found = false
        for (const [name, id] of Array.from(this.ctx.typeCache.entries())) {
          if (id === typeId) {
            result.set(typeId, name)
            this.typeCacheById.set(typeId, name)
            found = true
            break
          }
        }
        if (!found) {
          uncachedIds.push(typeId)
        }
      }
    }

    // Batch query for uncached IDs
    if (uncachedIds.length > 0) {
      // Build query: SELECT rowid, noun FROM nouns WHERE rowid IN (?, ?, ...)
      const placeholders = uncachedIds.map(() => '?').join(', ')
      const queryResult = await this.ctx.db.all(
        sql`SELECT rowid, noun FROM nouns WHERE rowid IN (${sql.join(uncachedIds.map(id => sql`${id}`), sql`, `)})`
      )

      // Process results
      for (const row of queryResult as Array<{ rowid: number; noun: string }>) {
        const typeId = row.rowid
        const typeName = row.noun

        // Populate both caches
        this.ctx.typeCache.set(typeName, typeId)
        this.typeCacheById.set(typeId, typeName)
        result.set(typeId, typeName)
      }

      // Handle any IDs that weren't found (set to 'Unknown')
      for (const typeId of uncachedIds) {
        if (!result.has(typeId)) {
          result.set(typeId, 'Unknown')
          this.typeCacheById.set(typeId, 'Unknown')
        }
      }
    }

    return result
  }

  async get(id: string, options: ThingsGetOptions = {}): Promise<ThingEntity | null> {
    const branch = options.branch ?? this.ctx.currentBranch
    const branchCondition = branch === 'main' ? isNull(schema.things.branch) : eq(schema.things.branch, branch)

    // If specific version requested
    if (options.version !== undefined) {
      const results = await this.ctx.db.all(
        sql`SELECT rowid as version, * FROM things WHERE id = ${id} ORDER BY rowid ASC`
      )
      const rows = results as any[]
      const targetRow = rows.find((r, idx) => idx + 1 === options.version)
      if (!targetRow) return null

      const typeName = await this.getTypeName(targetRow.type)
      return {
        $id: targetRow.id,
        $type: typeName,
        name: targetRow.name,
        data: typeof targetRow.data === 'string'
          ? safeJsonParse(targetRow.data, null, { context: 'ThingsStore.get.version' })
          : targetRow.data,
        branch: targetRow.branch,
        version: targetRow.version,
        deleted: !!targetRow.deleted,
      }
    }

    // Get latest version
    const results = await this.ctx.db
      .select()
      .from(schema.things)
      .where(and(eq(schema.things.id, id), branchCondition))
      .orderBy(desc(schema.things.id))

    // Get the latest by rowid using raw SQL
    // Note: For 'main' branch, we store NULL in the database, so we need IS NULL check
    const branchSql = branch === 'main'
      ? sql`branch IS NULL`
      : sql`branch = ${branch}`
    const allVersions = await this.ctx.db.all(
      sql`SELECT rowid as version, * FROM things WHERE id = ${id} AND ${branchSql} ORDER BY rowid DESC LIMIT 1`
    )
    const result = (allVersions as any[])[0]

    if (!result) return null

    // Check soft delete
    if (result.deleted && !options.includeDeleted) {
      return null
    }

    const typeName = await this.getTypeName(result.type)
    return {
      $id: result.id,
      $type: typeName,
      name: result.name,
      data: typeof result.data === 'string'
        ? safeJsonParse(result.data, null, { context: 'ThingsStore.get.latest' })
        : result.data,
      branch: result.branch,
      version: result.version,
      deleted: !!result.deleted,
    }
  }

  async list(options: ThingsListOptions = {}): Promise<ThingEntity[]> {
    const branch = options.branch ?? this.ctx.currentBranch
    const limit = options.limit ?? 100
    const offset = options.offset ?? 0

    // Get type ID if filtering by type (do this early to use in subquery)
    let typeId: number | undefined
    if (options.type) {
      typeId = await this.getTypeId(options.type)
    }

    // Build subquery conditions - all filters must be in the subquery
    // to correctly filter which things to return the latest version of
    let subqueryConditions = sql`WHERE 1=1`

    // Add branch condition
    if (branch === 'main') {
      subqueryConditions = sql`${subqueryConditions} AND branch IS NULL`
    } else {
      subqueryConditions = sql`${subqueryConditions} AND branch = ${branch}`
    }

    // Add type filter if specified (MUST be in subquery for correct SQL filtering)
    if (typeId !== undefined) {
      subqueryConditions = sql`${subqueryConditions} AND type = ${typeId}`
    }

    // Exclude soft-deleted by default
    if (!options.includeDeleted) {
      subqueryConditions = sql`${subqueryConditions} AND (deleted = 0 OR deleted IS NULL)`
    }

    // Handle cursor-based pagination (MUST be in subquery for correct SQL filtering)
    if (options.after) {
      subqueryConditions = sql`${subqueryConditions} AND id > ${options.after}`
    }

    // Group by id to get latest versions only
    // Use a subquery to get the max rowid per id with ALL filters applied
    const subquery = sql`
      SELECT id, MAX(rowid) as max_rowid
      FROM things
      ${subqueryConditions}
      GROUP BY id
    `

    // Join to get full records
    const fullQuery = sql`
      SELECT t.rowid as version, t.*
      FROM things t
      INNER JOIN (${subquery}) latest ON t.id = latest.id AND t.rowid = latest.max_rowid
    `

    // Add where clause for JSON filters
    let finalQuery = fullQuery
    if (options.where) {
      // Note: For production, would need proper JSON path queries
      // This is a simplified version
      for (const [key, value] of Object.entries(options.where)) {
        if (key.startsWith('data.')) {
          const jsonPath = key.replace('data.', '')
          // Build safe JSON path (validates and prefixes with $.)
          // The path is parameterized as a string value, not interpolated with sql.raw()
          const safePath = buildSafeJsonPath(jsonPath)
          finalQuery = sql`${finalQuery} AND json_extract(t.data, ${safePath}) = ${JSON.stringify(value)}`
        }
      }
    }

    // Add ordering using type-safe ORDER BY clause builder (no sql.raw())
    const orderColumn = validateOrderColumn(options.orderBy ?? 'id')
    const orderDir = options.order ?? 'asc'
    const orderClause = buildOrderClause(orderColumn, orderDir)
    // Extract just the ORDER BY part from the pre-built clause
    // The buildOrderClause returns a complete "ORDER BY t.column ASC/DESC" fragment
    finalQuery = sql`${finalQuery} ${orderClause}`

    // Add limit and offset
    finalQuery = sql`${finalQuery} LIMIT ${limit} OFFSET ${offset}`

    const results = await this.ctx.db.all(finalQuery)
    const rows = results as any[]

    // Batch lookup all type names to avoid N+1 queries
    const typeIds = rows.map((row) => row.type as number)
    const typeNameMap = await this.batchGetTypeNames(typeIds)

    // Map to ThingEntity using the pre-fetched type names
    const entities: ThingEntity[] = []
    for (const row of rows) {
      const typeName = typeNameMap.get(row.type) ?? 'Unknown'
      entities.push({
        $id: row.id,
        $type: typeName,
        name: row.name,
        data: typeof row.data === 'string'
          ? safeJsonParse(row.data, null, { context: 'ThingsStore.list' })
          : row.data,
        branch: row.branch,
        version: row.version,
        deleted: !!row.deleted,
      })
    }

    return entities
  }

  /**
   * Count things matching the given criteria without fetching all data.
   * More efficient than list() when only the count is needed.
   *
   * @param options - Filter options (type, branch, includeDeleted)
   * @returns Total count of matching things
   */
  async count(options: Pick<ThingsListOptions, 'type' | 'branch' | 'includeDeleted'> = {}): Promise<number> {
    const branch = options.branch ?? this.ctx.currentBranch

    // Get type ID if filtering by type
    let typeId: number | undefined
    if (options.type) {
      typeId = await this.getTypeId(options.type)
    }

    // Build conditions
    let conditions = sql`WHERE 1=1`

    // Add branch condition
    if (branch === 'main') {
      conditions = sql`${conditions} AND branch IS NULL`
    } else {
      conditions = sql`${conditions} AND branch = ${branch}`
    }

    // Add type filter if specified
    if (typeId !== undefined) {
      conditions = sql`${conditions} AND type = ${typeId}`
    }

    // Exclude soft-deleted by default
    if (!options.includeDeleted) {
      conditions = sql`${conditions} AND (deleted = 0 OR deleted IS NULL)`
    }

    // Count distinct IDs (for latest versions only)
    const countQuery = sql`
      SELECT COUNT(DISTINCT id) as count
      FROM things
      ${conditions}
    `

    try {
      const results = await this.ctx.db.all(countQuery)
      const row = (results as any[])[0]
      return row?.count ?? 0
    } catch (error) {
      logBestEffortError(error, {
        operation: 'count',
        source: 'ThingsStore.count',
        context: { type: options.type, branch },
      })
      return 0
    }
  }

  async create(data: Partial<ThingEntity> & { type?: string }, options: ThingsCreateOptions = {}): Promise<ThingEntity> {
    // Support both $type and type for backwards compatibility
    const typeName = data.$type ?? data.type
    if (!typeName) {
      throw new Error('$type is required')
    }

    const id = data.$id ?? crypto.randomUUID()
    const branch = options.branch ?? this.ctx.currentBranch

    // Get type ID (best-effort, may fail with mock DB)
    let typeId = 0
    try {
      typeId = await this.getTypeId(typeName)
    } catch (error) {
      logBestEffortError(error, {
        operation: 'getTypeId',
        source: 'ThingStore.create',
        context: { typeName, id },
      })
    }

    // Check for duplicate (best-effort, may fail with mock DB)
    let existing: ThingEntity | null = null
    try {
      existing = await this.get(id, { branch, includeDeleted: true })
    } catch (error) {
      logBestEffortError(error, {
        operation: 'checkDuplicate',
        source: 'ThingStore.create',
        context: { id, branch },
      })
    }
    if (existing) {
      throw new Error(`Thing with id '${id}' already exists`)
    }

    // Insert the thing (best-effort)
    try {
      await this.ctx.db.insert(schema.things).values({
        id,
        type: typeId,
        branch: branch === 'main' ? null : branch,
        name: data.name ?? null,
        data: data.data ?? null,
        deleted: false,
      })
    } catch (error) {
      logBestEffortError(error, {
        operation: 'insert',
        source: 'ThingStore.create',
        context: { id, typeName, branch },
      })
    }

    // Stream to EVENTS pipeline if configured (flat fields, Noun.event verb)
    if (this.ctx.env.EVENTS) {
      try {
        await this.ctx.env.EVENTS.send([createEvent(`${typeName}.created`, {
          source: this.ctx.ns,
          thingId: id,
          thingType: typeName,
          context: this.ctx.ns,
          branch: branch || null,
          data: typeof data.data === 'object' ? JSON.stringify(data.data) : String(data.data ?? ''),
        })])
      } catch (error) {
        logBestEffortError(error, {
          operation: 'stream',
          source: 'ThingStore.create',
          context: { id, typeName, verb: `${typeName}.created` },
        })
      }
    }

    // Get the created record with its version
    let created: ThingEntity | null = null
    try {
      created = await this.get(id, { branch })
    } catch (error) {
      logBestEffortError(error, {
        operation: 'getCreated',
        source: 'ThingStore.create',
        context: { id, branch },
      })
    }

    const result = created ?? {
      $id: id,
      $type: typeName,
      name: data.name ?? null,
      data: data.data ?? null,
      branch: branch === 'main' ? null : branch,
      deleted: false,
    }

    // Notify mutation callback for real-time sync
    if (this.onMutation && created) {
      try {
        this.onMutation('insert', created, created.version ?? 0)
      } catch (error) {
        logBestEffortError(error, {
          operation: 'onMutation',
          source: 'ThingStore.create',
          context: { id, typeName },
        })
      }
    }

    return result
  }

  async update(id: string, data: Partial<ThingEntity>, options: ThingsUpdateOptions = {}): Promise<ThingEntity> {
    const branch = options.branch ?? this.ctx.currentBranch
    const merge = options.merge !== false // Default to merge

    // Get the current version
    const current = await this.get(id, { branch })
    if (!current) {
      throw new Error(`Thing '${id}' not found`)
    }

    // Prepare updated data
    let newData = data.data
    if (merge && current.data && data.data) {
      // Deep merge
      newData = deepMerge(current.data, data.data)
    }

    // Insert new version (append-only)
    await this.ctx.db.insert(schema.things).values({
      id,
      type: await this.getTypeId(current.$type),
      branch: branch === 'main' ? null : branch,
      name: data.name ?? current.name,
      data: newData ?? current.data,
      deleted: false,
    })

    // Get the updated record
    const updated = await this.get(id, { branch })

    // Notify mutation callback for real-time sync
    if (this.onMutation && updated) {
      try {
        this.onMutation('update', updated, updated.version ?? 0)
      } catch (error) {
        logBestEffortError(error, {
          operation: 'onMutation',
          source: 'ThingStore.update',
          context: { id },
        })
      }
    }

    return updated!
  }

  async delete(id: string, options: ThingsDeleteOptions = {}): Promise<ThingEntity> {
    const branch = options.branch ?? this.ctx.currentBranch

    // Get the current version
    const current = await this.get(id, { branch, includeDeleted: true })
    if (!current) {
      throw new Error(`Thing '${id}' not found`)
    }

    let newVersion: number | undefined

    if (options.hard) {
      // Hard delete - remove all versions
      await this.ctx.db
        .delete(schema.things)
        .where(eq(schema.things.id, id))
      // Use previous version for hard delete since row is gone
      newVersion = current.version
    } else {
      // Soft delete - insert new version with deleted=true
      await this.ctx.db.insert(schema.things).values({
        id,
        type: await this.getTypeId(current.$type),
        branch: branch === 'main' ? null : branch,
        name: current.name,
        data: current.data,
        deleted: true,
      })
      // Get the new version
      const deleted = await this.get(id, { branch, includeDeleted: true })
      newVersion = deleted?.version
    }

    const result = { ...current, deleted: true, version: newVersion }

    // Notify mutation callback for real-time sync
    if (this.onMutation) {
      try {
        this.onMutation('delete', result, newVersion ?? 0)
      } catch (error) {
        logBestEffortError(error, {
          operation: 'onMutation',
          source: 'ThingStore.delete',
          context: { id },
        })
      }
    }

    return result
  }

  async versions(id: string): Promise<ThingEntity[]> {
    const results = await this.ctx.db.all(
      sql`SELECT rowid as version, * FROM things WHERE id = ${id} ORDER BY rowid ASC`
    )

    const rows = results as any[]

    // Batch lookup all type names to avoid N+1 queries
    const typeIds = rows.map((row) => row.type as number)
    const typeNameMap = await this.batchGetTypeNames(typeIds)

    // Map to ThingEntity using the pre-fetched type names
    const entities: ThingEntity[] = []
    for (const row of rows) {
      const typeName = typeNameMap.get(row.type) ?? 'Unknown'
      entities.push({
        $id: row.id,
        $type: typeName,
        name: row.name,
        data: typeof row.data === 'string'
          ? safeJsonParse(row.data, null, { context: 'ThingsStore.versions' })
          : row.data,
        branch: row.branch,
        version: row.version,
        deleted: !!row.deleted,
      })
    }

    return entities
  }
}

// ============================================================================
// RELATIONSHIPS STORE
// ============================================================================

export class RelationshipsStore {
  constructor(private ctx: StoreContext) {}

  async create(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }): Promise<RelationshipEntity> {
    const id = crypto.randomUUID()

    // Check for duplicate
    const existing = await this.ctx.db
      .select()
      .from(schema.relationships)
      .where(
        and(
          eq(schema.relationships.verb, data.verb),
          eq(schema.relationships.from, data.from),
          eq(schema.relationships.to, data.to)
        )
      )
      .limit(1)

    if (existing.length > 0) {
      throw new Error('Duplicate relationship already exists')
    }

    const now = new Date()
    await this.ctx.db.insert(schema.relationships).values({
      id,
      verb: data.verb,
      from: data.from,
      to: data.to,
      data: data.data ?? null,
      createdAt: now,
    })

    return {
      id,
      verb: data.verb,
      from: data.from,
      to: data.to,
      data: data.data ?? null,
      createdAt: now,
    }
  }

  async list(options: RelationshipsListOptions = {}): Promise<RelationshipEntity[]> {
    const limit = options.limit ?? 100
    const offset = options.offset ?? 0

    let query = this.ctx.db.select().from(schema.relationships)

    // Build conditions
    const conditions: ReturnType<typeof eq>[] = []
    if (options.from) conditions.push(eq(schema.relationships.from, options.from))
    if (options.to) conditions.push(eq(schema.relationships.to, options.to))
    if (options.verb) conditions.push(eq(schema.relationships.verb, options.verb))

    let results
    if (conditions.length > 0) {
      results = await this.ctx.db
        .select()
        .from(schema.relationships)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions as [any, any, ...any[]]))
        .limit(limit)
        .offset(offset)
    } else {
      results = await this.ctx.db
        .select()
        .from(schema.relationships)
        .limit(limit)
        .offset(offset)
    }

    return results.map((r) => ({
      id: r.id,
      verb: r.verb,
      from: r.from,
      to: r.to,
      data: r.data as Record<string, unknown> | null,
      createdAt: r.createdAt,
    }))
  }

  async delete(id: string): Promise<RelationshipEntity> {
    // Get the relationship first
    const existing = await this.ctx.db
      .select()
      .from(schema.relationships)
      .where(eq(schema.relationships.id, id))
      .limit(1)

    if (existing.length === 0) {
      throw new Error(`Relationship '${id}' not found`)
    }

    await this.ctx.db
      .delete(schema.relationships)
      .where(eq(schema.relationships.id, id))

    return {
      id: existing[0]!.id,
      verb: existing[0]!.verb,
      from: existing[0]!.from,
      to: existing[0]!.to,
      data: existing[0]!.data as Record<string, unknown> | null,
      createdAt: existing[0]!.createdAt,
    }
  }

  async deleteWhere(criteria: { from?: string; to?: string; verb?: string }): Promise<number> {
    const conditions: ReturnType<typeof eq>[] = []
    if (criteria.from) conditions.push(eq(schema.relationships.from, criteria.from))
    if (criteria.to) conditions.push(eq(schema.relationships.to, criteria.to))
    if (criteria.verb) conditions.push(eq(schema.relationships.verb, criteria.verb))

    if (conditions.length === 0) {
      return 0
    }

    // Get count first
    const toDelete = await this.list({
      from: criteria.from,
      to: criteria.to,
      verb: criteria.verb,
    })

    // Delete
    await this.ctx.db
      .delete(schema.relationships)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions as [any, any, ...any[]]))

    return toDelete.length
  }

  async from(url: string, options: RelationshipsTraversalOptions = {}): Promise<RelationshipEntity[]> {
    return this.list({ from: url, verb: options.verb })
  }

  async to(url: string, options: RelationshipsTraversalOptions = {}): Promise<RelationshipEntity[]> {
    return this.list({ to: url, verb: options.verb })
  }
}

// ============================================================================
// ACTIONS STORE
// ============================================================================

export class ActionsStore {
  constructor(private ctx: StoreContext) {}

  async log(options: ActionsLogOptions): Promise<ActionEntity> {
    const id = crypto.randomUUID()
    const now = new Date()

    await this.ctx.db.insert(schema.actions).values({
      id,
      verb: options.verb,
      target: options.target,
      actor: options.actor ?? null,
      input: typeof options.input === 'object' ? null : options.input,
      output: options.output ?? null,
      options: typeof options.input === 'object' ? options.input : null,
      durability: options.durability ?? 'try',
      status: 'pending',
      requestId: options.requestId ?? null,
      sessionId: options.sessionId ?? null,
      workflowId: options.workflowId ?? null,
      createdAt: now,
    })

    return {
      id,
      verb: options.verb,
      target: options.target,
      actor: options.actor ?? null,
      input: options.input ?? null,
      output: options.output ?? null,
      durability: options.durability ?? 'try',
      status: 'pending',
      requestId: options.requestId ?? null,
      sessionId: options.sessionId ?? null,
      workflowId: options.workflowId ?? null,
      createdAt: now,
      retryCount: 0,
    }
  }

  async complete(id: string, output: unknown): Promise<ActionEntity> {
    // Get the action first
    const action = await this.get(id)
    if (!action) {
      throw new Error(`Action '${id}' not found`)
    }

    if (action.status === 'completed') {
      throw new Error('Action already completed')
    }

    const now = new Date()
    const duration = now.getTime() - action.createdAt.getTime()

    await this.ctx.db
      .update(schema.actions)
      .set({
        status: 'completed',
        output: typeof output === 'object' ? null : output as number,
        completedAt: now,
        duration,
      })
      .where(eq(schema.actions.id, id))

    return {
      ...action,
      status: 'completed',
      output: output as any,
      completedAt: now,
      duration,
    }
  }

  async fail(id: string, error: Error | Record<string, unknown>): Promise<ActionEntity> {
    // Get the action first
    const action = await this.get(id)
    if (!action) {
      throw new Error(`Action '${id}' not found`)
    }

    const now = new Date()
    const errorData = error instanceof Error
      ? { message: error.message, name: error.name }
      : error

    await this.ctx.db
      .update(schema.actions)
      .set({
        status: 'failed',
        error: errorData,
        completedAt: now,
      })
      .where(eq(schema.actions.id, id))

    return {
      ...action,
      status: 'failed',
      error: errorData,
      completedAt: now,
    }
  }

  async retry(id: string): Promise<ActionEntity> {
    // Get the action first
    const action = await this.get(id)
    if (!action) {
      throw new Error(`Action '${id}' not found`)
    }

    if (action.durability === 'send') {
      throw new Error("Cannot retry action with durability 'send'")
    }

    const retryCount = (action.retryCount ?? 0) + 1

    await this.ctx.db
      .update(schema.actions)
      .set({
        status: 'retrying',
        error: null,
        completedAt: null,
      })
      .where(eq(schema.actions.id, id))

    return {
      ...action,
      status: 'retrying',
      error: null,
      completedAt: null,
      retryCount,
    }
  }

  async get(id: string): Promise<ActionEntity | null> {
    const results = await this.ctx.db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.id, id))
      .limit(1)

    if (results.length === 0) return null

    const r = results[0]!
    return {
      id: r.id,
      verb: r.verb,
      target: r.target,
      actor: r.actor,
      input: r.input ?? r.options as any,
      output: r.output,
      options: r.options as Record<string, unknown> | null,
      durability: r.durability,
      status: r.status,
      error: r.error as Record<string, unknown> | null,
      requestId: r.requestId,
      sessionId: r.sessionId,
      workflowId: r.workflowId,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      duration: r.duration,
      retryCount: 0, // Would need to track this in DB
    }
  }

  async list(options: ActionsListOptions = {}): Promise<ActionEntity[]> {
    const conditions: ReturnType<typeof eq>[] = []
    if (options.target) conditions.push(eq(schema.actions.target, options.target))
    if (options.actor) conditions.push(eq(schema.actions.actor, options.actor))
    if (options.status) conditions.push(eq(schema.actions.status, options.status as any))
    if (options.verb) conditions.push(eq(schema.actions.verb, options.verb))

    let results
    if (conditions.length > 0) {
      results = await this.ctx.db
        .select()
        .from(schema.actions)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions as [any, any, ...any[]]))
    } else {
      results = await this.ctx.db
        .select()
        .from(schema.actions)
    }

    return results.map((r) => ({
      id: r.id,
      verb: r.verb,
      target: r.target,
      actor: r.actor,
      input: r.input ?? r.options as any,
      output: r.output,
      options: r.options as Record<string, unknown> | null,
      durability: r.durability,
      status: r.status,
      error: r.error as Record<string, unknown> | null,
      requestId: r.requestId,
      sessionId: r.sessionId,
      workflowId: r.workflowId,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      duration: r.duration,
      retryCount: 0,
    }))
  }

  async pending(): Promise<ActionEntity[]> {
    return this.list({ status: 'pending' })
  }

  async failed(): Promise<ActionEntity[]> {
    return this.list({ status: 'failed' })
  }
}

// ============================================================================
// EVENTS STORE
// ============================================================================

export class EventsStore {
  private sequenceCounter = 0

  constructor(private ctx: StoreContext) {}

  async emit(options: EventsEmitOptions): Promise<EventEntity> {
    const id = crypto.randomUUID()
    const now = new Date()
    this.sequenceCounter++

    // Insert event (best-effort)
    try {
      await this.ctx.db.insert(schema.events).values({
        id,
        verb: options.verb,
        source: options.source,
        data: options.data,
        actionId: options.actionId ?? null,
        sequence: this.sequenceCounter,
        streamed: false,
        createdAt: now,
      })
    } catch (error) {
      logBestEffortError(error, {
        operation: 'insert',
        source: 'EventsStore.emit',
        context: { id, verb: options.verb, ns: this.ctx.ns },
      })
    }

    // Stream to EVENTS pipeline if configured (flat fields, Noun.event verb)
    if (this.ctx.env.EVENTS) {
      try {
        await this.ctx.env.EVENTS.send([createEvent(options.verb, {
          source: options.source,
          eventId: id,
          context: this.ctx.ns,
          data: typeof options.data === 'object' ? JSON.stringify(options.data) : String(options.data ?? ''),
        })])
      } catch (error) {
        logBestEffortError(error, {
          operation: 'stream',
          source: 'EventsStore.emit',
          context: { id, verb: options.verb, ns: this.ctx.ns },
        })
      }
    }

    return {
      id,
      verb: options.verb,
      source: options.source,
      data: options.data,
      actionId: options.actionId ?? null,
      sequence: this.sequenceCounter,
      streamed: false,
      createdAt: now,
    }
  }

  async stream(id: string): Promise<EventEntity> {
    // Get the event
    const event = await this.get(id)
    if (!event) {
      throw new Error(`Event '${id}' not found`)
    }

    const now = new Date()

    // Send to EVENTS pipeline (flat fields, Noun.event verb)
    if (this.ctx.env.EVENTS) {
      await this.ctx.env.EVENTS.send([createEvent(event.verb, {
        source: event.source,
        eventId: event.id,
        context: this.ctx.ns,
        data: typeof event.data === 'object' ? JSON.stringify(event.data) : String(event.data ?? ''),
      })])
    }

    // Mark as streamed
    await this.ctx.db
      .update(schema.events)
      .set({
        streamed: true,
        streamedAt: now,
      })
      .where(eq(schema.events.id, id))

    return {
      ...event,
      streamed: true,
      streamedAt: now,
    }
  }

  async streamPending(): Promise<number> {
    const pending = await this.ctx.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.streamed, false))

    let count = 0
    for (const event of pending) {
      await this.stream(event.id)
      count++
    }

    return count
  }

  async get(id: string): Promise<EventEntity | null> {
    const results = await this.ctx.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .limit(1)

    if (results.length === 0) return null

    const r = results[0]!
    return {
      id: r.id,
      verb: r.verb,
      source: r.source,
      data: r.data as Record<string, unknown>,
      actionId: r.actionId,
      sequence: r.sequence,
      streamed: !!r.streamed,
      streamedAt: r.streamedAt ?? undefined,
      createdAt: r.createdAt,
    }
  }

  async list(options: EventsListOptions = {}): Promise<EventEntity[]> {
    const conditions: ReturnType<typeof eq>[] = []
    if (options.source) conditions.push(eq(schema.events.source, options.source))
    if (options.verb) conditions.push(eq(schema.events.verb, options.verb))

    let query = this.ctx.db.select().from(schema.events)

    let results
    if (conditions.length > 0) {
      results = await query.where(conditions.length === 1 ? conditions[0] : and(...conditions as [any, any, ...any[]]))
    } else {
      results = await query
    }

    // Filter by afterSequence if specified
    if (options.afterSequence !== undefined) {
      results = results.filter((r) => r.sequence > options.afterSequence!)
    }

    // Sort
    if (options.orderBy === 'sequence') {
      results.sort((a, b) => {
        if (options.order === 'desc') {
          return b.sequence - a.sequence
        }
        return a.sequence - b.sequence
      })
    }

    return results.map((r) => ({
      id: r.id,
      verb: r.verb,
      source: r.source,
      data: r.data as Record<string, unknown>,
      actionId: r.actionId,
      sequence: r.sequence,
      streamed: !!r.streamed,
      streamedAt: r.streamedAt ?? undefined,
      createdAt: r.createdAt,
    }))
  }

  async replay(options: EventsReplayOptions): Promise<EventEntity[]> {
    const limit = options.limit ?? 100

    const results = await this.ctx.db
      .select()
      .from(schema.events)
      .orderBy(asc(schema.events.sequence))
      .limit(limit)

    return results
      .filter((r) => r.sequence >= options.fromSequence)
      .map((r) => ({
        id: r.id,
        verb: r.verb,
        source: r.source,
        data: r.data as Record<string, unknown>,
        actionId: r.actionId,
        sequence: r.sequence,
        streamed: !!r.streamed,
        streamedAt: r.streamedAt ?? undefined,
        createdAt: r.createdAt,
      }))
  }
}

// ============================================================================
// SEARCH STORE
// ============================================================================

export class SearchStore {
  constructor(private ctx: StoreContext) {}

  async index(entry: { $id: string; $type: string; content: string }): Promise<SearchEntry> {
    const now = new Date()

    // Check if entry exists
    const existing = await this.ctx.db
      .select()
      .from(schema.search)
      .where(eq(schema.search.$id, entry.$id))
      .limit(1)

    if (existing.length > 0) {
      // Update existing
      await this.ctx.db
        .update(schema.search)
        .set({
          $type: entry.$type,
          content: entry.content,
          indexedAt: now,
        })
        .where(eq(schema.search.$id, entry.$id))
    } else {
      // Insert new
      await this.ctx.db.insert(schema.search).values({
        $id: entry.$id,
        $type: entry.$type,
        content: entry.content,
        indexedAt: now,
      })
    }

    // TODO: Generate embedding if AI binding available

    return {
      $id: entry.$id,
      $type: entry.$type,
      content: entry.content,
      indexedAt: now,
    }
  }

  async indexMany(entries: { $id: string; $type: string; content: string }[]): Promise<SearchEntry[]> {
    const results: SearchEntry[] = []
    for (const entry of entries) {
      results.push(await this.index(entry))
    }
    return results
  }

  async remove(id: string): Promise<void> {
    await this.ctx.db
      .delete(schema.search)
      .where(eq(schema.search.$id, id))
  }

  async removeMany(ids: string[]): Promise<number> {
    let count = 0
    for (const id of ids) {
      const existing = await this.ctx.db
        .select()
        .from(schema.search)
        .where(eq(schema.search.$id, id))
        .limit(1)

      if (existing.length > 0) {
        await this.remove(id)
        count++
      }
    }
    return count
  }

  async query(text: string, options: SearchQueryOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? 10

    // Simple text search using LIKE
    let results = await this.ctx.db
      .select()
      .from(schema.search)
      .limit(limit * 2) // Get more to allow filtering

    // Filter by content match
    const searchTerms = text.toLowerCase().split(/\s+/)
    results = results.filter((r) => {
      const content = r.content.toLowerCase()
      return searchTerms.some((term) => content.includes(term))
    })

    // Filter by type if specified
    if (options.type) {
      results = results.filter((r) => r.$type === options.type)
    }

    // Limit
    results = results.slice(0, limit)

    // Calculate simple relevance scores
    return results.map((r) => {
      const content = r.content.toLowerCase()
      let score = 0
      for (const term of searchTerms) {
        if (content.includes(term)) {
          score += 1
        }
      }
      score = score / searchTerms.length // Normalize

      return {
        $id: r.$id,
        $type: r.$type,
        content: r.content,
        embedding: r.embedding ?? null,
        embeddingDim: r.embeddingDim ?? undefined,
        indexedAt: r.indexedAt,
        score,
      }
    }).sort((a, b) => b.score - a.score)
  }

  async semantic(text: string, options: SearchQueryOptions = {}): Promise<SearchResult[]> {
    // For now, fall back to text search
    // Would use vector similarity with embeddings in production
    return this.query(text, options)
  }

  async reindexType(type: string): Promise<number> {
    // Get all things of this type from things store
    // Re-index them
    // For now, just return 0
    return 0
  }
}

// ============================================================================
// OBJECTS STORE
// ============================================================================

export class ObjectsStore {
  constructor(private ctx: StoreContext) {}

  /**
   * Create a new object registration (alias for register with test-friendly signature)
   */
  async create(options: ObjectsCreateOptions): Promise<DOObjectEntity> {
    return this.register({
      ns: options.ns,
      id: options.doId,
      class: options.doClass,
      relation: options.relation,
      shardKey: options.shardKey,
      shardIndex: options.shardIndex,
      region: options.region,
      colo: options.colo,
      primary: options.primary,
    })
  }

  async register(options: ObjectsRegisterOptions): Promise<DOObjectEntity> {
    const now = new Date()

    // Check for duplicate
    const existing = await this.get(options.ns)
    if (existing) {
      throw new Error(`Object with ns '${options.ns}' already exists`)
    }

    // Validate relation type if provided
    const validRelations = ['parent', 'child', 'follower', 'shard', 'reference'] as const
    type RelationType = typeof validRelations[number]
    const relation = options.relation as RelationType | undefined

    await this.ctx.db.insert(schema.objects).values({
      ns: options.ns,
      id: options.id,
      class: options.class,
      relation: relation ?? null,
      shardKey: options.shardKey ?? null,
      shardIndex: options.shardIndex ?? null,
      region: options.region ?? null,
      primary: options.primary ?? null,
      createdAt: now,
    })

    return {
      ns: options.ns,
      id: options.id,
      class: options.class,
      relation: options.relation ?? null,
      shardKey: options.shardKey ?? null,
      shardIndex: options.shardIndex ?? null,
      region: options.region ?? null,
      colo: options.colo ?? null,
      primary: options.primary ?? null,
      createdAt: now,
    }
  }

  async get(ns: string): Promise<DOObjectEntity | null> {
    const results = await this.ctx.db
      .select()
      .from(schema.objects)
      .where(eq(schema.objects.ns, ns))
      .limit(1)

    if (results.length === 0) return null

    const r = results[0]!
    // Extract colo from cached data if available (stored there since not in schema)
    const cached = r.cached as Record<string, unknown> | null
    return {
      ns: r.ns,
      id: r.id,
      class: r.class,
      relation: r.relation,
      shardKey: r.shardKey,
      shardIndex: r.shardIndex,
      region: r.region,
      colo: cached?.colo as string | null ?? null,
      primary: r.primary,
      cached: cached,
      createdAt: r.createdAt,
    }
  }

  async list(options: ObjectsListOptions = {}): Promise<DOObjectEntity[]> {
    const conditions: ReturnType<typeof eq>[] = []
    if (options.relation) conditions.push(eq(schema.objects.relation, options.relation as any))
    if (options.class) conditions.push(eq(schema.objects.class, options.class))
    if (options.region) conditions.push(eq(schema.objects.region, options.region))

    let results
    if (conditions.length > 0) {
      results = await this.ctx.db
        .select()
        .from(schema.objects)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions as [any, any, ...any[]]))
    } else {
      results = await this.ctx.db
        .select()
        .from(schema.objects)
    }

    // Map results and filter by colo if specified (colo is stored in cached field)
    let mapped = results.map((r) => {
      const cached = r.cached as Record<string, unknown> | null
      return {
        ns: r.ns,
        id: r.id,
        class: r.class,
        relation: r.relation,
        shardKey: r.shardKey,
        shardIndex: r.shardIndex,
        region: r.region,
        colo: cached?.colo as string | null ?? null,
        primary: r.primary,
        cached: cached,
        createdAt: r.createdAt,
      }
    })

    // Filter by colo if specified (done in JS since colo is in cached JSON)
    if (options.colo) {
      mapped = mapped.filter((r) => r.colo === options.colo)
    }

    return mapped
  }

  async shards(key: string): Promise<DOObjectEntity[]> {
    const results = await this.ctx.db
      .select()
      .from(schema.objects)
      .where(eq(schema.objects.shardKey, key))

    return results.map((r) => {
      const cached = r.cached as Record<string, unknown> | null
      return {
        ns: r.ns,
        id: r.id,
        class: r.class,
        relation: r.relation,
        shardKey: r.shardKey,
        shardIndex: r.shardIndex,
        region: r.region,
        colo: cached?.colo as string | null ?? null,
        primary: r.primary,
        cached: cached,
        createdAt: r.createdAt,
      }
    })
  }

  async primary(ns: string): Promise<DOObjectEntity | null> {
    const obj = await this.get(ns)
    if (obj && obj.primary) {
      return obj
    }
    return null
  }

  async update(ns: string, data: Partial<DOObjectEntity>): Promise<DOObjectEntity> {
    const existing = await this.get(ns)
    if (!existing) {
      throw new Error(`Object '${ns}' not found`)
    }

    await this.ctx.db
      .update(schema.objects)
      .set({
        cached: data.cached ?? existing.cached,
        region: data.region ?? existing.region,
        primary: data.primary ?? existing.primary,
      })
      .where(eq(schema.objects.ns, ns))

    return {
      ...existing,
      cached: data.cached ?? existing.cached,
      region: data.region ?? existing.region,
      primary: data.primary ?? existing.primary,
    }
  }

  async delete(ns: string): Promise<void> {
    const existing = await this.get(ns)
    if (!existing) {
      throw new Error(`Object '${ns}' not found`)
    }

    await this.ctx.db
      .delete(schema.objects)
      .where(eq(schema.objects.ns, ns))
  }

  async resolve(ns: string): Promise<{ fetch(request: Request): Promise<Response> }> {
    const obj = await this.get(ns)
    if (!obj) {
      throw new Error(`Object '${ns}' not found`)
    }

    if (!this.ctx.env.DO) {
      throw new Error('DO namespace not available')
    }

    const doId = this.ctx.env.DO.idFromString(obj.id)
    return this.ctx.env.DO.get(doId)
  }

  /**
   * Get an object from R2 SQL global registry (fallback for cross-DO resolution)
   *
   * This is called when the local objects table doesn't have the namespace.
   * The R2 SQL database stores a global registry of all namespaces across DOs.
   *
   * @param ns - The namespace to look up
   * @returns The object entity if found, null otherwise
   */
  async getGlobal(ns: string): Promise<DOObjectEntity | null> {
    // Check if R2 SQL binding is available
    const r2Sql = this.ctx.env.R2_SQL as {
      exec(query: string, params: unknown[]): Promise<{ results: unknown[] }>
    } | undefined

    if (!r2Sql) {
      // R2 SQL not configured, return null
      return null
    }

    try {
      // Query the global objects registry in R2 SQL
      const result = await r2Sql.exec(
        'SELECT ns, id, class, relation, shard_key, shard_index, region, "primary", cached, created_at FROM objects WHERE ns = ?',
        [ns]
      )

      if (!result.results || result.results.length === 0) {
        return null
      }

      const r = result.results[0] as {
        ns: string
        id: string
        class: string
        relation: string | null
        shard_key: string | null
        shard_index: number | null
        region: string | null
        primary: boolean | null
        cached: string | null
        created_at: string
      }

      return {
        ns: r.ns,
        id: r.id,
        class: r.class,
        relation: r.relation,
        shardKey: r.shard_key,
        shardIndex: r.shard_index,
        region: r.region,
        primary: r.primary,
        cached: r.cached
          ? safeJsonParse(r.cached, null, { context: 'ObjectsStore.getGlobal' })
          : null,
        createdAt: new Date(r.created_at),
      }
    } catch (error) {
      // R2 SQL query failed, return null (fallback behavior)
      console.error('R2 SQL global lookup failed:', error)
      return null
    }
  }
}

// ============================================================================
// DLQ TYPES
// ============================================================================

export interface DLQEntity {
  id: string
  eventId: string | null
  verb: string
  source: string
  data: Record<string, unknown>
  error: string
  errorStack: string | null
  retryCount: number
  maxRetries: number
  lastAttemptAt: Date | null
  createdAt: Date
  /** Idempotency key for deduplication (hash of eventId + verb + data) */
  idempotencyKey?: string
  /** Next scheduled retry time (for exponential backoff) */
  nextRetryAt?: Date | null
  /** Status: pending, replaying, exhausted, archived */
  status?: 'pending' | 'replaying' | 'exhausted' | 'archived'
}

export interface DLQAddOptions {
  eventId?: string
  verb: string
  source: string
  data: Record<string, unknown>
  error: string
  errorStack?: string
  maxRetries?: number
  /** Custom idempotency key (auto-generated if not provided) */
  idempotencyKey?: string
}

export interface DLQListOptions {
  verb?: string
  source?: string
  minRetries?: number
  maxRetries?: number
  limit?: number
  offset?: number
  /** Filter by status */
  status?: 'pending' | 'replaying' | 'exhausted' | 'archived'
  /** Only return entries ready for retry (nextRetryAt <= now) */
  readyForRetry?: boolean
}

export interface DLQReplayResult {
  success: boolean
  result?: unknown
  error?: string
  /** Whether this was a duplicate replay (idempotency check) */
  deduplicated?: boolean
  /** Number of retry attempts made */
  retryCount?: number
}

export interface DLQReplayAllResult {
  replayed: number
  failed: number
  /** Number of entries skipped due to idempotency */
  skipped: number
  /** Details for observability */
  details?: Array<{ id: string; success: boolean; error?: string }>
}

// ============================================================================
// DLQ STORE
// ============================================================================

/**
 * Default base delay for exponential backoff (1 second)
 */
const DLQ_BASE_DELAY_MS = 1000

/**
 * Maximum delay cap for exponential backoff (1 hour)
 */
const DLQ_MAX_DELAY_MS = 60 * 60 * 1000

/**
 * Generate idempotency key from event properties
 */
function generateIdempotencyKey(eventId: string | undefined, verb: string, data: Record<string, unknown>): string {
  const content = JSON.stringify({ eventId, verb, data })
  // Simple hash for idempotency - in production could use crypto.subtle
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `dlq_${Math.abs(hash).toString(36)}_${verb}`
}

/**
 * Calculate next retry time using exponential backoff with jitter
 */
function calculateNextRetryTime(retryCount: number, baseDelayMs = DLQ_BASE_DELAY_MS): Date {
  // Exponential backoff: baseDelay * 2^retryCount
  const exponentialDelay = baseDelayMs * Math.pow(2, retryCount)
  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, DLQ_MAX_DELAY_MS)
  // Add jitter (0-25% of delay) to prevent thundering herd
  const jitter = cappedDelay * Math.random() * 0.25
  const totalDelay = cappedDelay + jitter

  return new Date(Date.now() + totalDelay)
}

export class DLQStore {
  private db: StoreContext['db']
  private ns: string
  private eventHandlers: Map<string, (data: unknown) => Promise<unknown>>
  /** Track in-flight replays for idempotency within a single request */
  private inFlightReplays: Set<string> = new Set()

  constructor(ctx: StoreContext, eventHandlers?: Map<string, (data: unknown) => Promise<unknown>>) {
    this.db = ctx.db
    this.ns = ctx.ns
    this.eventHandlers = eventHandlers || new Map()
  }

  /**
   * Register a handler for replaying events of a specific verb
   */
  registerHandler(verb: string, handler: (data: unknown) => Promise<unknown>): void {
    this.eventHandlers.set(verb, handler)
  }

  /**
   * Add a failed event to the DLQ with idempotency support
   *
   * If an entry with the same idempotency key already exists, returns
   * the existing entry instead of creating a duplicate.
   */
  async add(options: DLQAddOptions): Promise<DLQEntity> {
    const id = crypto.randomUUID()
    const now = new Date()
    const idempotencyKey = options.idempotencyKey ?? generateIdempotencyKey(options.eventId, options.verb, options.data)

    // Check for existing entry with same idempotency key (deduplication)
    const existing = await this.findByIdempotencyKey(idempotencyKey)
    if (existing) {
      logBestEffortError(new Error('DLQ entry deduplicated'), {
        operation: 'add',
        source: 'DLQStore.add',
        context: { idempotencyKey, existingId: existing.id, verb: options.verb },
      })
      return existing
    }

    // Calculate initial next retry time
    const nextRetryAt = calculateNextRetryTime(0)

    try {
      await this.db.insert(schema.dlq).values({
        id,
        eventId: options.eventId ?? null,
        verb: options.verb,
        source: options.source,
        data: options.data,
        error: options.error,
        errorStack: options.errorStack ?? null,
        retryCount: 0,
        maxRetries: options.maxRetries ?? 3,
        lastAttemptAt: now,
        createdAt: now,
      })
    } catch (error) {
      logBestEffortError(error, {
        operation: 'insert',
        source: 'DLQStore.add',
        context: { id, verb: options.verb, source: options.source },
      })
      throw error
    }

    console.log(`[DLQ] Added entry: id=${id}, verb=${options.verb}, source=${options.source}, error=${options.error.slice(0, 100)}`)

    return {
      id,
      eventId: options.eventId ?? null,
      verb: options.verb,
      source: options.source,
      data: options.data,
      error: options.error,
      errorStack: options.errorStack ?? null,
      retryCount: 0,
      maxRetries: options.maxRetries ?? 3,
      lastAttemptAt: now,
      createdAt: now,
      idempotencyKey,
      nextRetryAt,
      status: 'pending',
    }
  }

  /**
   * Find a DLQ entry by idempotency key
   */
  async findByIdempotencyKey(idempotencyKey: string): Promise<DLQEntity | null> {
    // Note: This would be more efficient with a dedicated index on idempotencyKey
    // For now, we filter in-memory since the DLQ table is typically small
    const results = await this.db.select().from(schema.dlq)
    // Filter by computing idempotency key for each entry
    for (const row of results) {
      const rowKey = generateIdempotencyKey(row.eventId ?? undefined, row.verb, row.data as Record<string, unknown>)
      if (rowKey === idempotencyKey) {
        return this.toEntity(row)
      }
    }
    return null
  }

  /**
   * Get a DLQ entry by ID
   */
  async get(id: string): Promise<DLQEntity | null> {
    try {
      const results = await this.db
        .select()
        .from(schema.dlq)
        .where(eq(schema.dlq.id, id))
        .limit(1)

      if (results.length === 0) return null
      return this.toEntity(results[0]!)
    } catch (error) {
      logBestEffortError(error, {
        operation: 'get',
        source: 'DLQStore.get',
        context: { id },
      })
      // Fallback to in-memory filter for compatibility
      const results = await this.db.select().from(schema.dlq)
      const result = results.find((r) => r.id === id)
      if (!result) return null
      return this.toEntity(result)
    }
  }

  /**
   * List DLQ entries with filtering and pagination
   */
  async list(options?: DLQListOptions): Promise<DLQEntity[]> {
    try {
      const results = await this.db.select().from(schema.dlq)
      let filtered = results

      if (options?.verb) {
        filtered = filtered.filter((r) => r.verb === options.verb)
      }
      if (options?.source) {
        filtered = filtered.filter((r) => r.source === options.source)
      }
      if (options?.minRetries !== undefined) {
        filtered = filtered.filter((r) => r.retryCount >= options.minRetries!)
      }
      if (options?.maxRetries !== undefined) {
        filtered = filtered.filter((r) => r.retryCount <= options.maxRetries!)
      }
      if (options?.status) {
        // Filter by computed status
        filtered = filtered.filter((r) => {
          const entity = this.toEntity(r)
          return entity.status === options.status
        })
      }
      if (options?.readyForRetry) {
        const now = new Date()
        filtered = filtered.filter((r) => {
          const entity = this.toEntity(r)
          return entity.nextRetryAt ? entity.nextRetryAt <= now : true
        })
      }

      const offset = options?.offset ?? 0
      const limit = options?.limit ?? filtered.length
      filtered = filtered.slice(offset, offset + limit)

      return filtered.map((r) => this.toEntity(r))
    } catch (error) {
      logBestEffortError(error, {
        operation: 'list',
        source: 'DLQStore.list',
        context: { options },
      })
      return []
    }
  }

  /**
   * Count total DLQ entries
   */
  async count(): Promise<number> {
    try {
      const results = await this.db.select().from(schema.dlq)
      return results.length
    } catch (error) {
      logBestEffortError(error, {
        operation: 'count',
        source: 'DLQStore.count',
        context: {},
      })
      return 0
    }
  }

  /**
   * Increment retry count and update timestamps
   * Now persists changes to the database
   */
  async incrementRetry(id: string): Promise<DLQEntity> {
    const entry = await this.get(id)
    if (!entry) {
      throw new Error(`DLQ entry with id ${id} not found`)
    }

    const now = new Date()
    const newRetryCount = entry.retryCount + 1
    const nextRetryAt = calculateNextRetryTime(newRetryCount)

    try {
      // Persist the retry count update to the database
      await this.db
        .update(schema.dlq)
        .set({
          retryCount: newRetryCount,
          lastAttemptAt: now,
        })
        .where(eq(schema.dlq.id, id))
    } catch (error) {
      logBestEffortError(error, {
        operation: 'incrementRetry',
        source: 'DLQStore.incrementRetry',
        context: { id, newRetryCount },
      })
      // Continue even if update fails - return the computed state
    }

    console.log(`[DLQ] Incremented retry: id=${id}, retryCount=${newRetryCount}, nextRetryAt=${nextRetryAt.toISOString()}`)

    return {
      ...entry,
      retryCount: newRetryCount,
      lastAttemptAt: now,
      nextRetryAt,
      status: newRetryCount >= entry.maxRetries ? 'exhausted' : 'pending',
    }
  }

  /**
   * Replay a single DLQ entry with idempotency protection
   *
   * Features:
   * - In-flight deduplication (prevents concurrent replays of same entry)
   * - Automatic retry count tracking
   * - Success removes entry from DLQ
   * - Failure updates retry count and next retry time
   */
  async replay(id: string): Promise<DLQReplayResult> {
    // Idempotency check: prevent concurrent replays
    if (this.inFlightReplays.has(id)) {
      console.log(`[DLQ] Replay deduplicated (in-flight): id=${id}`)
      return { success: false, deduplicated: true, error: 'Replay already in progress' }
    }

    const entry = await this.get(id)
    if (!entry) {
      return { success: false, error: `DLQ entry with id ${id} not found` }
    }

    // Check if exhausted
    if (entry.retryCount >= entry.maxRetries) {
      console.log(`[DLQ] Replay skipped (exhausted): id=${id}, retryCount=${entry.retryCount}, maxRetries=${entry.maxRetries}`)
      return { success: false, error: 'Max retries exceeded', retryCount: entry.retryCount }
    }

    const handler = this.eventHandlers.get(entry.verb)
    if (!handler) {
      console.log(`[DLQ] Replay failed (no handler): id=${id}, verb=${entry.verb}`)
      return { success: false, error: `No handler registered for verb: ${entry.verb}` }
    }

    // Mark as in-flight
    this.inFlightReplays.add(id)
    const startTime = Date.now()

    try {
      // Increment retry count before attempting
      const updated = await this.incrementRetry(id)

      console.log(`[DLQ] Replaying: id=${id}, verb=${entry.verb}, attempt=${updated.retryCount}`)

      const result = await handler(entry.data)

      // Success - remove from DLQ
      await this.remove(id)

      const duration = Date.now() - startTime
      console.log(`[DLQ] Replay success: id=${id}, verb=${entry.verb}, duration=${duration}ms`)

      return { success: true, result, retryCount: updated.retryCount }
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      console.error(`[DLQ] Replay failed: id=${id}, verb=${entry.verb}, duration=${duration}ms, error=${errorMessage}`)

      // Update error in DLQ entry
      try {
        await this.db
          .update(schema.dlq)
          .set({
            error: errorMessage,
            errorStack: error instanceof Error ? error.stack ?? null : null,
          })
          .where(eq(schema.dlq.id, id))
      } catch (updateError) {
        logBestEffortError(updateError, {
          operation: 'updateError',
          source: 'DLQStore.replay',
          context: { id, originalError: errorMessage },
        })
      }

      return {
        success: false,
        error: errorMessage,
        retryCount: entry.retryCount + 1,
      }
    } finally {
      // Remove from in-flight set
      this.inFlightReplays.delete(id)
    }
  }

  /**
   * Replay all DLQ entries matching filter criteria
   *
   * Features:
   * - Batch replay with progress tracking
   * - Skips exhausted entries
   * - Returns detailed results for observability
   */
  async replayAll(options?: { verb?: string; source?: string; includeDetails?: boolean }): Promise<DLQReplayAllResult> {
    const entries = await this.list({
      verb: options?.verb,
      source: options?.source,
      readyForRetry: true, // Only replay entries that are ready
    })

    let replayed = 0
    let failed = 0
    let skipped = 0
    const details: Array<{ id: string; success: boolean; error?: string }> = []

    console.log(`[DLQ] Starting batch replay: count=${entries.length}, filter=${JSON.stringify(options ?? {})}`)

    for (const entry of entries) {
      // Skip exhausted entries
      if (entry.retryCount >= entry.maxRetries) {
        skipped++
        if (options?.includeDetails) {
          details.push({ id: entry.id, success: false, error: 'Max retries exceeded' })
        }
        continue
      }

      const result = await this.replay(entry.id)

      if (result.deduplicated) {
        skipped++
      } else if (result.success) {
        replayed++
      } else {
        failed++
      }

      if (options?.includeDetails) {
        details.push({ id: entry.id, success: result.success, error: result.error })
      }
    }

    console.log(`[DLQ] Batch replay complete: replayed=${replayed}, failed=${failed}, skipped=${skipped}`)

    const result: DLQReplayAllResult = { replayed, failed, skipped }
    if (options?.includeDetails) {
      result.details = details
    }
    return result
  }

  /**
   * Retry a DLQ entry by replaying it.
   * Alias for replay() to match expected DLQStore interface.
   */
  async retry(id: string): Promise<DLQReplayResult> {
    return this.replay(id)
  }

  /**
   * Remove a DLQ entry from the database
   * Now actually performs the database delete operation
   */
  async remove(id: string): Promise<boolean> {
    const entry = await this.get(id)
    if (!entry) {
      return false
    }

    try {
      await this.db
        .delete(schema.dlq)
        .where(eq(schema.dlq.id, id))

      console.log(`[DLQ] Removed entry: id=${id}, verb=${entry.verb}`)
      return true
    } catch (error) {
      logBestEffortError(error, {
        operation: 'remove',
        source: 'DLQStore.remove',
        context: { id },
      })
      return false
    }
  }

  /**
   * Purge exhausted entries (entries that have exceeded max retries)
   *
   * Returns the count of purged entries for observability
   */
  async purgeExhausted(): Promise<number> {
    const entries = await this.list()
    const exhausted = entries.filter((e) => e.retryCount >= e.maxRetries)

    console.log(`[DLQ] Purging exhausted entries: count=${exhausted.length}`)

    let purged = 0
    for (const entry of exhausted) {
      // Archive before removing (log for audit trail)
      console.log(`[DLQ] Archiving exhausted entry: id=${entry.id}, verb=${entry.verb}, retryCount=${entry.retryCount}, error=${entry.error.slice(0, 100)}`)

      const removed = await this.remove(entry.id)
      if (removed) {
        purged++
      }
    }

    console.log(`[DLQ] Purge complete: purged=${purged}`)
    return purged
  }

  /**
   * Get statistics about the DLQ for monitoring and alerting
   */
  async stats(): Promise<{
    total: number
    pending: number
    exhausted: number
    byVerb: Record<string, number>
    avgRetryCount: number
    oldestEntry: Date | null
  }> {
    const entries = await this.list()

    const pending = entries.filter((e) => e.retryCount < e.maxRetries).length
    const exhausted = entries.filter((e) => e.retryCount >= e.maxRetries).length

    const byVerb: Record<string, number> = {}
    for (const entry of entries) {
      byVerb[entry.verb] = (byVerb[entry.verb] ?? 0) + 1
    }

    const avgRetryCount = entries.length > 0
      ? entries.reduce((sum, e) => sum + e.retryCount, 0) / entries.length
      : 0

    const oldestEntry = entries.length > 0
      ? entries.reduce((oldest, e) => e.createdAt < oldest ? e.createdAt : oldest, entries[0]!.createdAt)
      : null

    return {
      total: entries.length,
      pending,
      exhausted,
      byVerb,
      avgRetryCount,
      oldestEntry,
    }
  }

  /**
   * Convert database row to DLQEntity with computed fields
   */
  private toEntity(row: typeof schema.dlq.$inferSelect): DLQEntity {
    const idempotencyKey = generateIdempotencyKey(row.eventId ?? undefined, row.verb, row.data as Record<string, unknown>)
    const nextRetryAt = calculateNextRetryTime(row.retryCount)
    const status: 'pending' | 'exhausted' = row.retryCount >= row.maxRetries ? 'exhausted' : 'pending'

    return {
      id: row.id,
      eventId: row.eventId,
      verb: row.verb,
      source: row.source,
      data: row.data as Record<string, unknown>,
      error: row.error,
      errorStack: row.errorStack,
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      lastAttemptAt: row.lastAttemptAt ?? null,
      createdAt: row.createdAt,
      idempotencyKey,
      nextRetryAt,
      status,
    }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }

  for (const key of Object.keys(source)) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      )
    } else {
      result[key] = sourceValue
    }
  }

  return result
}
