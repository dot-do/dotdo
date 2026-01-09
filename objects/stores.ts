/**
 * Store Accessors for DO Base Class
 *
 * Provides typed store accessors for:
 * - ThingsStore: CRUD operations for Things
 * - RelationshipsStore: Relationship management
 * - ActionsStore: Action logging and lifecycle
 * - EventsStore: Event emission and streaming
 * - SearchStore: Full-text and semantic search
 * - ObjectsStore: DO registry and resolution
 */

import { eq, and, or, desc, asc, isNull, sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from '../db'

// ============================================================================
// SQL INJECTION PREVENTION
// ============================================================================

/**
 * Whitelist of columns allowed for orderBy in ThingsStore.list()
 * These match the actual columns in the things table schema.
 */
export const ALLOWED_ORDER_COLUMNS = Object.freeze([
  'id',
  'name',
  'type',
  'branch',
  'deleted',
] as const)

export type AllowedOrderColumn = typeof ALLOWED_ORDER_COLUMNS[number]

/**
 * Validates that an orderBy column name is in the allowed whitelist.
 * Throws an error if the column is not allowed or contains invalid characters.
 *
 * @param column - The column name to validate
 * @returns The validated column name
 * @throws Error if the column is not in the whitelist
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
 * Only allows alphanumeric characters, underscores, and dots (for nested paths).
 * Does not allow:
 * - Starting or ending with dots
 * - Consecutive dots
 * - Special characters (quotes, parentheses, semicolons, etc.)
 */
const VALID_JSON_PATH_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/

/**
 * Validates that a JSON path is safe for use in SQL queries.
 * Only allows alphanumeric characters, underscores, and dots.
 *
 * @param path - The JSON path to validate
 * @returns The validated JSON path
 * @throws Error if the path contains invalid characters
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
 * Type-safe ORDER BY clause builder.
 * Returns a pre-built SQL fragment for the ORDER BY clause based on validated column.
 * This approach completely eliminates the need for sql.raw() by using a lookup table.
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
 * Uses pre-defined SQL fragments looked up by validated column name.
 *
 * @param column - The validated column name
 * @param direction - The sort direction ('asc' or 'desc')
 * @returns A safe SQL fragment for the ORDER BY clause
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
 * Security: The path is validated against a strict regex before building.
 * The JSON path validation regex ensures:
 * - Starts with letter or underscore
 * - Contains only alphanumeric chars, underscores, and dots
 * - No consecutive dots, no leading/trailing dots
 * - No SQL metacharacters (quotes, semicolons, parentheses, etc.)
 *
 * The resulting path is then used as a parameterized value (not raw SQL),
 * which is safe because:
 * 1. SQLite's json_extract() only interprets the value as a JSON path selector
 * 2. The validation rejects any SQL metacharacters
 * 3. Drizzle's sql template tag properly escapes the parameterized string
 */
export function buildSafeJsonPath(path: string): string {
  const validated = validateJsonPath(path)
  return `$.${validated}`
}

/**
 * Builds a type-safe JSON extract condition using parameterized binding.
 *
 * Security: Uses buildSafeJsonPath() which validates the path against a strict
 * regex before constructing the full path string. The path is then passed as
 * a parameterized value (not sql.raw()), which is safe because:
 * 1. SQLite's json_extract() only interprets the value as a JSON path selector
 * 2. The validation rejects any SQL metacharacters
 * 3. Parameterized binding escapes any special characters
 *
 * @param path - The JSON path to validate and use
 * @param value - The value to compare against (will be parameterized)
 * @returns A safe SQL fragment for the JSON extract condition
 */
export function buildJsonCondition(path: string, value: unknown) {
  const safePath = buildSafeJsonPath(path)
  return sql`json_extract(t.data, ${safePath}) = ${JSON.stringify(value)}`
}

// ============================================================================
// THING TYPES
// ============================================================================

export interface ThingEntity {
  $id: string
  $type: string
  name?: string | null
  data?: Record<string, unknown> | null
  branch?: string | null
  version?: number
  deleted?: boolean
}

export interface ThingsGetOptions {
  branch?: string
  version?: number
  includeDeleted?: boolean
}

export interface ThingsListOptions {
  type?: string
  branch?: string
  orderBy?: string
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
  after?: string
  includeDeleted?: boolean
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
  primary?: boolean
}

export interface ObjectsListOptions {
  relation?: string
  class?: string
}

// ============================================================================
// STORE CONTEXT
// ============================================================================

export interface StoreContext {
  db: DrizzleD1Database<typeof schema>
  ns: string
  currentBranch: string
  env: {
    DO?: {
      idFromName(name: string): { toString(): string }
      idFromString(id: string): { toString(): string }
      get(id: { toString(): string }): { fetch(request: Request): Promise<Response> }
    }
    PIPELINE?: { send(data: unknown): Promise<void> }
    AI?: { fetch(request: Request): Promise<Response> }
  }
  typeCache: Map<string, number>
}

// ============================================================================
// THINGS STORE
// ============================================================================

export class ThingsStore {
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
        data: typeof targetRow.data === 'string' ? JSON.parse(targetRow.data) : targetRow.data,
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
    const allVersions = await this.ctx.db.all(
      sql`SELECT rowid as version, * FROM things WHERE id = ${id} AND (branch = ${branch === 'main' ? null : branch} OR (${branch === 'main'} AND branch IS NULL)) ORDER BY rowid DESC LIMIT 1`
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
      data: typeof result.data === 'string' ? JSON.parse(result.data) : result.data,
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
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
        branch: row.branch,
        version: row.version,
        deleted: !!row.deleted,
      })
    }

    return entities
  }

  async create(data: Partial<ThingEntity>, options: ThingsCreateOptions = {}): Promise<ThingEntity> {
    if (!data.$type) {
      throw new Error('$type is required')
    }

    const id = data.$id ?? crypto.randomUUID()
    const branch = options.branch ?? this.ctx.currentBranch
    const typeId = await this.getTypeId(data.$type)

    // Check for duplicate
    const existing = await this.get(id, { branch, includeDeleted: true })
    if (existing) {
      throw new Error(`Thing with id '${id}' already exists`)
    }

    // Insert the thing
    await this.ctx.db.insert(schema.things).values({
      id,
      type: typeId,
      branch: branch === 'main' ? null : branch,
      name: data.name ?? null,
      data: data.data ?? null,
      deleted: false,
    })

    // Get the created record with its version
    const created = await this.get(id, { branch })
    return created!
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
    return updated!
  }

  async delete(id: string, options: ThingsDeleteOptions = {}): Promise<ThingEntity> {
    const branch = options.branch ?? this.ctx.currentBranch

    // Get the current version
    const current = await this.get(id, { branch, includeDeleted: true })
    if (!current) {
      throw new Error(`Thing '${id}' not found`)
    }

    if (options.hard) {
      // Hard delete - remove all versions
      await this.ctx.db
        .delete(schema.things)
        .where(eq(schema.things.id, id))
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
    }

    // Return the deleted thing
    return { ...current, deleted: true }
  }

  async versions(id: string): Promise<ThingEntity[]> {
    const results = await this.ctx.db.all(
      sql`SELECT rowid as version, * FROM things WHERE id = ${id} ORDER BY rowid ASC`
    )

    const entities: ThingEntity[] = []
    for (const row of results as any[]) {
      const typeName = await this.getTypeName(row.type)
      entities.push({
        $id: row.id,
        $type: typeName,
        name: row.name,
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
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
      id: existing[0].id,
      verb: existing[0].verb,
      from: existing[0].from,
      to: existing[0].to,
      data: existing[0].data as Record<string, unknown> | null,
      createdAt: existing[0].createdAt,
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

    const r = results[0]
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

    // Send to pipeline
    if (this.ctx.env.PIPELINE) {
      await this.ctx.env.PIPELINE.send({
        id: event.id,
        verb: event.verb,
        source: event.source,
        data: event.data,
        timestamp: now.toISOString(),
      })
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

    const r = results[0]
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

    const r = results[0]
    return {
      ns: r.ns,
      id: r.id,
      class: r.class,
      relation: r.relation,
      shardKey: r.shardKey,
      shardIndex: r.shardIndex,
      region: r.region,
      primary: r.primary,
      cached: r.cached as Record<string, unknown> | null,
      createdAt: r.createdAt,
    }
  }

  async list(options: ObjectsListOptions = {}): Promise<DOObjectEntity[]> {
    const conditions: ReturnType<typeof eq>[] = []
    if (options.relation) conditions.push(eq(schema.objects.relation, options.relation as any))
    if (options.class) conditions.push(eq(schema.objects.class, options.class))

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

    return results.map((r) => ({
      ns: r.ns,
      id: r.id,
      class: r.class,
      relation: r.relation,
      shardKey: r.shardKey,
      shardIndex: r.shardIndex,
      region: r.region,
      primary: r.primary,
      cached: r.cached as Record<string, unknown> | null,
      createdAt: r.createdAt,
    }))
  }

  async shards(key: string): Promise<DOObjectEntity[]> {
    const results = await this.ctx.db
      .select()
      .from(schema.objects)
      .where(eq(schema.objects.shardKey, key))

    return results.map((r) => ({
      ns: r.ns,
      id: r.id,
      class: r.class,
      relation: r.relation,
      shardKey: r.shardKey,
      shardIndex: r.shardIndex,
      region: r.region,
      primary: r.primary,
      cached: r.cached as Record<string, unknown> | null,
      createdAt: r.createdAt,
    }))
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
