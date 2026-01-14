/**
 * DO Integration Test Worker
 *
 * Test worker that exports DOBase for integration tests with real SQLite storage.
 * Used by @cloudflare/vitest-pool-workers to test the REST router and DO lifecycle
 * with actual Durable Object SQLite persistence.
 *
 * Includes RPC-enabled wrappers for ThingsStore, RelationshipsStore, and SQL access
 * to enable Workers RPC direct method invocation (stub.things.create(), etc.)
 *
 * @module workers/do-integration-test-worker
 */

import { DO } from '../objects/core/DOBase'
import type { Env } from '../objects/core/DOBase'
import { sql } from 'drizzle-orm'
import { RpcTarget } from 'cloudflare:workers'
import type {
  ThingsStore,
  RelationshipsStore,
  ActionsStore,
  EventsStore,
  ThingEntity,
  RelationshipEntity,
  ActionEntity,
  EventEntity,
  ThingsGetOptions,
  ThingsListOptions,
  ThingsUpdateOptions,
  ThingsDeleteOptions,
  RelationshipsListOptions,
  RelationshipsTraversalOptions,
  ActionsLogOptions,
  ActionsListOptions,
  EventsEmitOptions,
  EventsListOptions,
  EventsReplayOptions,
} from '../db/stores'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'

// ============================================================================
// RPC WRAPPER CLASSES
// ============================================================================

/**
 * RPC-enabled wrapper for ThingsStore.
 * Extends RpcTarget to enable Workers RPC pattern: stub.things.create()
 */
class ThingsRpc extends RpcTarget {
  constructor(private store: ThingsStore) {
    super()
  }

  async create(data: Partial<ThingEntity> & { type?: string }, options?: { branch?: string }): Promise<ThingEntity> {
    return this.store.create(data, options)
  }

  async get(id: string, options?: ThingsGetOptions): Promise<ThingEntity | null> {
    return this.store.get(id, options)
  }

  async list(options?: ThingsListOptions): Promise<ThingEntity[]> {
    return this.store.list(options)
  }

  async update(id: string, data: Partial<ThingEntity>, options?: ThingsUpdateOptions): Promise<ThingEntity> {
    return this.store.update(id, data, options)
  }

  async delete(id: string, options?: ThingsDeleteOptions): Promise<ThingEntity> {
    return this.store.delete(id, options)
  }

  async versions(id: string): Promise<ThingEntity[]> {
    return this.store.versions(id)
  }

  async query(options: { type: string; where?: Record<string, unknown> }): Promise<ThingEntity[]> {
    return this.store.list({
      type: options.type,
      where: options.where,
    })
  }

  async createMany(items: Array<Partial<ThingEntity> & { type?: string }>): Promise<ThingEntity[]> {
    // Validate all items first
    for (const item of items) {
      if (!item.$type && !item.type) {
        throw new Error('$type is required for all items')
      }
    }

    // Create each item (atomicity would need transaction support)
    const results: ThingEntity[] = []
    for (const item of items) {
      const created = await this.store.create(item)
      results.push(created)
    }
    return results
  }
}

/**
 * RPC-enabled wrapper for RelationshipsStore.
 * Extends RpcTarget to enable Workers RPC pattern: stub.rels.create()
 */
class RelsRpc extends RpcTarget {
  constructor(private store: RelationshipsStore) {
    super()
  }

  async create(data: {
    verb: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<RelationshipEntity> {
    return this.store.create(data)
  }

  async list(options?: RelationshipsListOptions): Promise<RelationshipEntity[]> {
    return this.store.list(options)
  }

  async query(options: {
    from?: string
    to?: string
    verb?: string
  }): Promise<Array<RelationshipEntity & { $id: string }>> {
    const results = await this.store.list(options)
    // Map id to $id for consistency
    return results.map((r) => ({ ...r, $id: r.id }))
  }

  async delete(id: string): Promise<RelationshipEntity> {
    return this.store.delete(id)
  }

  async deleteWhere(options: { from?: string; to?: string; verb?: string }): Promise<number> {
    return this.store.deleteWhere(options)
  }

  async from(url: string, options?: RelationshipsTraversalOptions): Promise<RelationshipEntity[]> {
    return this.store.from(url, options)
  }

  async to(url: string, options?: RelationshipsTraversalOptions): Promise<RelationshipEntity[]> {
    return this.store.to(url, options)
  }
}

/**
 * RPC-enabled wrapper for raw SQL access.
 * Extends RpcTarget to enable Workers RPC pattern: stub.sql.execute()
 */
class SqlRpc extends RpcTarget {
  constructor(private db: DrizzleSqliteDODatabase<any>) {
    super()
  }

  async execute(
    query: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; changes?: number; lastInsertRowid?: number }> {
    // Use raw SQL execution
    // Build parameterized query
    let sqlQuery: ReturnType<typeof sql.raw>
    if (params && params.length > 0) {
      // For parameterized queries, use positional parameters
      // SQLite uses ? for positional parameters
      const paramValues = params.map((p) => sql`${p}`)
      // Split query by ? and join with params
      const parts = query.split('?')
      if (parts.length - 1 !== paramValues.length) {
        throw new Error('Parameter count mismatch')
      }
      // Build query with parameters
      let combined = sql`${sql.raw(parts[0] || '')}`
      for (let i = 0; i < paramValues.length; i++) {
        combined = sql`${combined}${paramValues[i]}${sql.raw(parts[i + 1] || '')}`
      }
      sqlQuery = combined as any
    } else {
      sqlQuery = sql.raw(query)
    }

    const result = await this.db.all(sqlQuery)
    const rows = result as Record<string, unknown>[]

    // For mutations, try to get rowsAffected
    // Note: Drizzle doesn't expose changes directly, so we return undefined
    return { rows }
  }
}

/**
 * RPC-enabled wrapper for EventsStore.
 * Extends RpcTarget to enable Workers RPC pattern: stub.events.emit()
 */
class EventsRpc extends RpcTarget {
  constructor(private store: EventsStore) {
    super()
  }

  async emit(options: EventsEmitOptions): Promise<EventEntity> {
    return this.store.emit(options)
  }

  async get(id: string): Promise<EventEntity | null> {
    return this.store.get(id)
  }

  async list(options?: EventsListOptions): Promise<EventEntity[]> {
    return this.store.list(options)
  }

  async replay(options: EventsReplayOptions): Promise<EventEntity[]> {
    return this.store.replay(options)
  }

  async stream(id: string): Promise<EventEntity> {
    return this.store.stream(id)
  }

  async streamPending(): Promise<number> {
    return this.store.streamPending()
  }
}

/**
 * RPC-enabled wrapper for ActionsStore.
 * Extends RpcTarget to enable Workers RPC pattern: stub.actions.log()
 */
class ActionsRpc extends RpcTarget {
  constructor(private store: ActionsStore) {
    super()
  }

  async log(options: ActionsLogOptions): Promise<ActionEntity> {
    return this.store.log(options)
  }

  async get(id: string): Promise<ActionEntity | null> {
    return this.store.get(id)
  }

  async list(options?: ActionsListOptions): Promise<ActionEntity[]> {
    return this.store.list(options)
  }

  async complete(id: string, output: unknown): Promise<ActionEntity> {
    return this.store.complete(id, output)
  }

  async fail(id: string, error: Error | Record<string, unknown>): Promise<ActionEntity> {
    return this.store.fail(id, error)
  }

  async retry(id: string): Promise<ActionEntity> {
    return this.store.retry(id)
  }

  async pending(): Promise<ActionEntity[]> {
    return this.store.pending()
  }

  async failed(): Promise<ActionEntity[]> {
    return this.store.failed()
  }
}

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * Document metadata fields
 */
interface DocumentMetadata {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  $version: number
}

/**
 * Document with data and metadata
 */
type Document<T = Record<string, unknown>> = T & DocumentMetadata

/**
 * Query operators for filtering
 */
interface QueryOperators {
  $eq?: unknown
  $ne?: unknown
  $gt?: unknown
  $gte?: unknown
  $lt?: unknown
  $lte?: unknown
  $in?: unknown[]
  $nin?: unknown[]
  $like?: string
}

/**
 * Where clause for queries
 */
interface WhereClause {
  [field: string]: unknown | QueryOperators
  $and?: WhereClause[]
  $or?: WhereClause[]
}

/**
 * List options
 */
interface ListOptions {
  type?: string
  limit?: number
  offset?: number
  orderBy?: Record<string, 'asc' | 'desc'>
}

/**
 * Query options
 */
interface QueryOptions {
  type?: string
  where?: WhereClause
  limit?: number
  offset?: number
  orderBy?: Record<string, 'asc' | 'desc'>
}

/**
 * Search options
 */
interface SearchOptions {
  type?: string
  query: string
  fields?: string[]
  where?: WhereClause
  limit?: number
}

// ============================================================================
// DOCUMENTS RPC
// ============================================================================

/**
 * RPC-enabled wrapper for document storage.
 * Extends RpcTarget to enable Workers RPC pattern: stub.documents.create()
 *
 * Provides schema-free JSON document storage with:
 * - CRUD operations
 * - JSONPath queries with operators
 * - Full-text search via FTS5
 * - Batch operations
 */
class DocumentsRpc extends RpcTarget {
  constructor(private storage: DurableObjectStorage) {
    super()
  }

  /**
   * Generate a unique document ID
   */
  private generateId(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 21)
  }

  /**
   * Convert a dot-notation path to SQLite json_extract path
   */
  private toJsonPath(field: string): string {
    if (field.startsWith('$')) return field
    return `$.${field}`
  }

  /**
   * Get field expression for SQL queries
   */
  private getFieldExpr(field: string): string {
    if (field.startsWith('$')) {
      return `"${field}"`
    }
    return `json_extract(data, '${this.toJsonPath(field)}')`
  }

  /**
   * Build WHERE clause from query conditions
   */
  private buildWhereClause(where: WhereClause | undefined): { sql: string; params: unknown[] } {
    if (!where || Object.keys(where).length === 0) {
      return { sql: '1=1', params: [] }
    }

    const conditions: string[] = []
    const params: unknown[] = []

    // Handle $and
    if ('$and' in where && where.$and) {
      const andParts = where.$and.map(clause => this.buildWhereClause(clause))
      const andConditions = andParts.map(p => `(${p.sql})`).join(' AND ')
      conditions.push(`(${andConditions})`)
      for (const p of andParts) params.push(...p.params)
    }

    // Handle $or
    if ('$or' in where && where.$or) {
      const orParts = where.$or.map(clause => this.buildWhereClause(clause))
      const orConditions = orParts.map(p => `(${p.sql})`).join(' OR ')
      conditions.push(`(${orConditions})`)
      for (const p of orParts) params.push(...p.params)
    }

    // Handle field conditions
    for (const [field, condition] of Object.entries(where)) {
      if (field.startsWith('$')) continue // Skip logical operators

      const fieldExpr = this.getFieldExpr(field)

      if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
        const ops = condition as QueryOperators
        if ('$eq' in ops) {
          conditions.push(`${fieldExpr} = ?`)
          params.push(ops.$eq)
        }
        if ('$ne' in ops) {
          conditions.push(`${fieldExpr} != ?`)
          params.push(ops.$ne)
        }
        if ('$gt' in ops) {
          conditions.push(`${fieldExpr} > ?`)
          params.push(ops.$gt)
        }
        if ('$gte' in ops) {
          conditions.push(`${fieldExpr} >= ?`)
          params.push(ops.$gte)
        }
        if ('$lt' in ops) {
          conditions.push(`${fieldExpr} < ?`)
          params.push(ops.$lt)
        }
        if ('$lte' in ops) {
          conditions.push(`${fieldExpr} <= ?`)
          params.push(ops.$lte)
        }
        if ('$in' in ops && ops.$in) {
          const placeholders = ops.$in.map(() => '?').join(', ')
          conditions.push(`${fieldExpr} IN (${placeholders})`)
          params.push(...ops.$in)
        }
        if ('$nin' in ops && ops.$nin) {
          const placeholders = ops.$nin.map(() => '?').join(', ')
          conditions.push(`${fieldExpr} NOT IN (${placeholders})`)
          params.push(...ops.$nin)
        }
        if ('$like' in ops) {
          conditions.push(`${fieldExpr} LIKE ?`)
          params.push(ops.$like)
        }
      } else {
        // Simple equality
        conditions.push(`${fieldExpr} = ?`)
        params.push(condition)
      }
    }

    return {
      sql: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
      params,
    }
  }

  /**
   * Build ORDER BY clause
   */
  private buildOrderBy(orderBy?: Record<string, 'asc' | 'desc'>): string {
    if (!orderBy) return ''
    const parts = Object.entries(orderBy).map(([field, dir]) => {
      const fieldExpr = this.getFieldExpr(field)
      return `${fieldExpr} ${dir.toUpperCase()}`
    })
    return parts.length > 0 ? `ORDER BY ${parts.join(', ')}` : ''
  }

  /**
   * Set a nested value in an object using dot notation
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]
      if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {}
      }
      current = current[key] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }

  /**
   * Convert row to document
   */
  private rowToDocument<T>(row: {
    $id: string
    $type: string
    data: string
    $createdAt: number
    $updatedAt: number
    $version: number
  }): Document<T> {
    const data = JSON.parse(row.data) as T
    return {
      ...data,
      $id: row.$id,
      $type: row.$type,
      $createdAt: row.$createdAt,
      $updatedAt: row.$updatedAt,
      $version: row.$version,
    } as Document<T>
  }

  /**
   * Create a document
   */
  async create(input: Record<string, unknown>): Promise<Document> {
    const now = Date.now()
    const $id = (input.$id as string) || this.generateId()
    const $type = input.$type as string

    // Extract data (without system fields)
    const { $id: _, $type: __, $createdAt: ___, $updatedAt: ____, $version: _____, ...data } = input

    try {
      this.storage.sql.exec(
        `INSERT INTO documents ("$id", "$type", data, "$createdAt", "$updatedAt", "$version")
         VALUES (?, ?, ?, ?, ?, ?)`,
        $id,
        $type,
        JSON.stringify(data),
        now,
        now,
        1
      )
    } catch (e) {
      const error = e as Error
      if (error.message.includes('UNIQUE constraint failed') || error.message.includes('PRIMARY KEY')) {
        throw new Error(`Document with $id "${$id}" already exists`)
      }
      throw e
    }

    // Index for full-text search
    const title = (data as { title?: string }).title || ''
    const content = (data as { content?: string }).content || ''
    try {
      this.storage.sql.exec(
        `INSERT INTO documents_fts ("$id", title, content) VALUES (?, ?, ?)`,
        $id,
        title,
        content
      )
    } catch {
      // FTS index might fail if table doesn't exist, ignore
    }

    return {
      ...data,
      $id,
      $type,
      $createdAt: now,
      $updatedAt: now,
      $version: 1,
    } as Document
  }

  /**
   * Get a document by ID
   */
  async get($id: string): Promise<Document | null> {
    const cursor = this.storage.sql.exec(
      `SELECT "$id", "$type", data, "$createdAt", "$updatedAt", "$version"
       FROM documents
       WHERE "$id" = ? AND "$deletedAt" IS NULL`,
      $id
    )

    const rows = cursor.toArray()
    if (rows.length === 0) return null

    return this.rowToDocument(rows[0] as {
      $id: string
      $type: string
      data: string
      $createdAt: number
      $updatedAt: number
      $version: number
    })
  }

  /**
   * Update a document
   */
  async update($id: string, updates: Record<string, unknown>): Promise<Document> {
    const existing = await this.get($id)
    if (!existing) {
      throw new Error(`Document with $id "${$id}" not found`)
    }

    const now = Date.now()
    const { $id: _, $type: __, $createdAt, $updatedAt: ___, $version, ...existingData } = existing

    // Apply updates (handle dot notation)
    const newData = { ...existingData } as Record<string, unknown>
    for (const [key, value] of Object.entries(updates)) {
      if (key.startsWith('$')) continue // Skip system fields
      if (key.includes('.')) {
        this.setNestedValue(newData, key, value)
      } else {
        newData[key] = value
      }
    }

    const newVersion = $version + 1

    this.storage.sql.exec(
      `UPDATE documents
       SET data = ?, "$updatedAt" = ?, "$version" = ?
       WHERE "$id" = ?`,
      JSON.stringify(newData),
      now,
      newVersion,
      $id
    )

    // Update FTS index
    const title = (newData as { title?: string }).title || ''
    const content = (newData as { content?: string }).content || ''
    try {
      this.storage.sql.exec(
        `UPDATE documents_fts SET title = ?, content = ? WHERE "$id" = ?`,
        title,
        content,
        $id
      )
    } catch {
      // FTS update might fail, ignore
    }

    return {
      ...newData,
      $id,
      $type: existing.$type,
      $createdAt,
      $updatedAt: now,
      $version: newVersion,
    } as Document
  }

  /**
   * Delete a document (soft delete)
   */
  async delete($id: string): Promise<boolean> {
    const existing = await this.get($id)
    if (!existing) return false

    const now = Date.now()
    this.storage.sql.exec(
      `UPDATE documents SET "$deletedAt" = ? WHERE "$id" = ?`,
      now,
      $id
    )

    // Remove from FTS
    try {
      this.storage.sql.exec(
        `DELETE FROM documents_fts WHERE "$id" = ?`,
        $id
      )
    } catch {
      // FTS delete might fail, ignore
    }

    return true
  }

  /**
   * List documents of a type
   */
  async list(options: ListOptions = {}): Promise<Document[]> {
    let sqlStr = `SELECT "$id", "$type", data, "$createdAt", "$updatedAt", "$version"
                  FROM documents
                  WHERE "$deletedAt" IS NULL`
    const params: unknown[] = []

    if (options.type) {
      sqlStr += ` AND "$type" = ?`
      params.push(options.type)
    }

    // Add ORDER BY
    const orderBy = this.buildOrderBy(options.orderBy)
    if (orderBy) {
      sqlStr += ` ${orderBy}`
    } else {
      sqlStr += ` ORDER BY "$createdAt" DESC`
    }

    // Add LIMIT/OFFSET
    if (options.limit !== undefined) {
      sqlStr += ` LIMIT ?`
      params.push(options.limit)
      if (options.offset !== undefined) {
        sqlStr += ` OFFSET ?`
        params.push(options.offset)
      }
    }

    const cursor = this.storage.sql.exec(sqlStr, ...params)
    const rows = cursor.toArray()

    return rows.map(row => this.rowToDocument(row as {
      $id: string
      $type: string
      data: string
      $createdAt: number
      $updatedAt: number
      $version: number
    }))
  }

  /**
   * Query documents with filters
   */
  async query(options: QueryOptions): Promise<Document[]> {
    const { sql: whereCondition, params: whereParams } = this.buildWhereClause(options.where)

    let sqlStr = `SELECT "$id", "$type", data, "$createdAt", "$updatedAt", "$version"
                  FROM documents
                  WHERE "$deletedAt" IS NULL`
    const params: unknown[] = []

    if (options.type) {
      sqlStr += ` AND "$type" = ?`
      params.push(options.type)
    }

    sqlStr += ` AND (${whereCondition})`
    params.push(...whereParams)

    // Add ORDER BY
    const orderBy = this.buildOrderBy(options.orderBy)
    if (orderBy) {
      sqlStr += ` ${orderBy}`
    } else {
      sqlStr += ` ORDER BY "$createdAt" DESC`
    }

    // Add LIMIT/OFFSET
    if (options.limit !== undefined) {
      sqlStr += ` LIMIT ?`
      params.push(options.limit)
      if (options.offset !== undefined) {
        sqlStr += ` OFFSET ?`
        params.push(options.offset)
      }
    }

    const cursor = this.storage.sql.exec(sqlStr, ...params)
    const rows = cursor.toArray()

    return rows.map(row => this.rowToDocument(row as {
      $id: string
      $type: string
      data: string
      $createdAt: number
      $updatedAt: number
      $version: number
    }))
  }

  /**
   * Full-text search
   */
  async search(options: SearchOptions): Promise<Document[]> {
    const { query, type, where, fields, limit } = options

    // Build FTS query
    let sqlStr: string
    const params: unknown[] = []

    if (fields && fields.length > 0) {
      // Search specific fields
      const fieldConditions = fields.map(f => `${f}:${query}`).join(' OR ')
      sqlStr = `SELECT d."$id", d."$type", d.data, d."$createdAt", d."$updatedAt", d."$version",
                       bm25(documents_fts) as rank
                FROM documents d
                JOIN documents_fts fts ON d."$id" = fts."$id"
                WHERE documents_fts MATCH ? AND d."$deletedAt" IS NULL`
      params.push(fieldConditions)
    } else {
      // Search all indexed fields
      sqlStr = `SELECT d."$id", d."$type", d.data, d."$createdAt", d."$updatedAt", d."$version",
                       bm25(documents_fts) as rank
                FROM documents d
                JOIN documents_fts fts ON d."$id" = fts."$id"
                WHERE documents_fts MATCH ? AND d."$deletedAt" IS NULL`
      params.push(query)
    }

    if (type) {
      sqlStr += ` AND d."$type" = ?`
      params.push(type)
    }

    // Add additional where conditions
    if (where) {
      const { sql: whereCondition, params: whereParams } = this.buildWhereClause(where)
      // Replace json_extract(data, with json_extract(d.data,
      const adjustedWhere = whereCondition.replace(/json_extract\(data,/g, 'json_extract(d.data,')
      sqlStr += ` AND (${adjustedWhere})`
      params.push(...whereParams)
    }

    // Order by relevance
    sqlStr += ` ORDER BY rank`

    if (limit) {
      sqlStr += ` LIMIT ?`
      params.push(limit)
    }

    try {
      const cursor = this.storage.sql.exec(sqlStr, ...params)
      const rows = cursor.toArray()

      return rows.map(row => this.rowToDocument(row as {
        $id: string
        $type: string
        data: string
        $createdAt: number
        $updatedAt: number
        $version: number
      }))
    } catch {
      // FTS might not be set up, fall back to LIKE search
      return this.fallbackSearch(options)
    }
  }

  /**
   * Fallback search using LIKE when FTS is not available
   */
  private async fallbackSearch(options: SearchOptions): Promise<Document[]> {
    const { query, type, where, fields, limit } = options

    let sqlStr = `SELECT "$id", "$type", data, "$createdAt", "$updatedAt", "$version"
                  FROM documents
                  WHERE "$deletedAt" IS NULL`
    const params: unknown[] = []

    if (type) {
      sqlStr += ` AND "$type" = ?`
      params.push(type)
    }

    // Search in fields or content
    const searchFields = fields || ['title', 'content']
    const likeConditions = searchFields.map(f => `${this.getFieldExpr(f)} LIKE ?`)
    sqlStr += ` AND (${likeConditions.join(' OR ')})`
    for (let i = 0; i < searchFields.length; i++) {
      params.push(`%${query}%`)
    }

    // Add additional where conditions
    if (where) {
      const { sql: whereCondition, params: whereParams } = this.buildWhereClause(where)
      sqlStr += ` AND (${whereCondition})`
      params.push(...whereParams)
    }

    if (limit) {
      sqlStr += ` LIMIT ?`
      params.push(limit)
    }

    const cursor = this.storage.sql.exec(sqlStr, ...params)
    const rows = cursor.toArray()

    // Sort by relevance (count of query occurrences)
    const docs = rows.map(row => this.rowToDocument(row as {
      $id: string
      $type: string
      data: string
      $createdAt: number
      $updatedAt: number
      $version: number
    }))

    // Sort by number of occurrences of query term
    const lowerQuery = query.toLowerCase()
    docs.sort((a, b) => {
      const aStr = JSON.stringify(a).toLowerCase()
      const bStr = JSON.stringify(b).toLowerCase()
      const aCount = (aStr.match(new RegExp(lowerQuery, 'g')) || []).length
      const bCount = (bStr.match(new RegExp(lowerQuery, 'g')) || []).length
      return bCount - aCount
    })

    return docs
  }

  /**
   * Create multiple documents atomically
   */
  async createMany(inputs: Record<string, unknown>[]): Promise<Document[]> {
    // Check for duplicate $ids within the batch
    const ids = inputs.map(i => i.$id).filter(Boolean) as string[]
    const uniqueIds = new Set(ids)
    if (ids.length !== uniqueIds.size) {
      throw new Error('Duplicate $id in batch')
    }

    const documents: Document[] = []

    // Create each document (DO storage auto-coalesces writes)
    // Note: Durable Objects don't support explicit transactions via SQL,
    // but writes within a single request are atomic
    for (const input of inputs) {
      const doc = await this.create(input)
      documents.push(doc)
    }

    return documents
  }

  /**
   * Update multiple documents matching filter
   */
  async updateMany(
    filter: QueryOptions,
    updates: Record<string, unknown>
  ): Promise<number> {
    const docs = await this.query(filter)
    for (const doc of docs) {
      await this.update(doc.$id, updates)
    }
    return docs.length
  }

  /**
   * Delete multiple documents matching filter
   */
  async deleteMany(filter: QueryOptions): Promise<number> {
    const docs = await this.query(filter)
    for (const doc of docs) {
      await this.delete(doc.$id)
    }
    return docs.length
  }

  /**
   * Upsert a document
   */
  async upsert(
    filter: { $id: string },
    data: Record<string, unknown>
  ): Promise<Document> {
    const existing = await this.get(filter.$id)

    if (existing) {
      // Update - extract only non-system fields
      const { $id: _, $type: __, $createdAt: ___, $updatedAt: ____, $version: _____, ...updates } = data
      return this.update(filter.$id, updates)
    } else {
      // Create
      return this.create({
        ...data,
        $id: filter.$id,
      })
    }
  }
}

// ============================================================================
// SCHEMA INITIALIZATION SQL
// ============================================================================

/**
 * Schema statements for integration tests.
 * Each statement creates a table or index needed for ThingsStore to work.
 */
const SCHEMA_STATEMENTS = [
  // Nouns table (type registry) - includes all columns from db/nouns.ts
  `CREATE TABLE IF NOT EXISTS nouns (
    noun TEXT PRIMARY KEY,
    plural TEXT,
    description TEXT,
    schema TEXT,
    do_class TEXT,
    sharded INTEGER DEFAULT 0,
    shard_count INTEGER DEFAULT 1,
    shard_key TEXT,
    storage TEXT DEFAULT 'hot',
    ttl_days INTEGER,
    indexed_fields TEXT,
    ns_strategy TEXT DEFAULT 'tenant',
    replica_regions TEXT,
    consistency_mode TEXT DEFAULT 'eventual',
    replica_binding TEXT
  )`,

  // Things table (entity storage)
  `CREATE TABLE IF NOT EXISTS things (
    id TEXT NOT NULL,
    type INTEGER NOT NULL,
    branch TEXT,
    name TEXT,
    data TEXT,
    deleted INTEGER DEFAULT 0,
    visibility TEXT DEFAULT 'user'
  )`,

  // Indexes for things table
  `CREATE INDEX IF NOT EXISTS things_id_idx ON things(id)`,
  `CREATE INDEX IF NOT EXISTS things_type_idx ON things(type)`,
  `CREATE INDEX IF NOT EXISTS things_branch_idx ON things(branch)`,
  `CREATE INDEX IF NOT EXISTS things_id_branch_idx ON things(id, branch)`,

  // Relationships table
  `CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    data TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // Indexes for relationships table
  `CREATE INDEX IF NOT EXISTS relationships_from_idx ON relationships("from")`,
  `CREATE INDEX IF NOT EXISTS relationships_to_idx ON relationships("to")`,
  `CREATE INDEX IF NOT EXISTS relationships_verb_idx ON relationships(verb)`,

  // Objects table (DO registry)
  `CREATE TABLE IF NOT EXISTS objects (
    ns TEXT NOT NULL,
    id TEXT NOT NULL,
    class TEXT NOT NULL,
    relation TEXT,
    shard_key TEXT,
    shard_index INTEGER,
    region TEXT,
    is_primary INTEGER,
    cached TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (ns, id)
  )`,

  // Events table (append-only event log)
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    source TEXT NOT NULL,
    data TEXT,
    action_id TEXT,
    sequence INTEGER NOT NULL,
    streamed INTEGER DEFAULT 0,
    streamed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // Indexes for events table
  `CREATE INDEX IF NOT EXISTS events_verb_idx ON events(verb)`,
  `CREATE INDEX IF NOT EXISTS events_source_idx ON events(source)`,
  `CREATE INDEX IF NOT EXISTS events_sequence_idx ON events(sequence)`,
  `CREATE INDEX IF NOT EXISTS events_streamed_idx ON events(streamed)`,

  // Actions table (workflow action log)
  `CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    target TEXT NOT NULL,
    actor TEXT,
    input TEXT,
    output TEXT,
    options TEXT,
    durability TEXT DEFAULT 'try',
    status TEXT DEFAULT 'pending',
    error TEXT,
    request_id TEXT,
    session_id TEXT,
    workflow_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT,
    duration INTEGER
  )`,

  // Indexes for actions table
  `CREATE INDEX IF NOT EXISTS actions_target_idx ON actions(target)`,
  `CREATE INDEX IF NOT EXISTS actions_actor_idx ON actions(actor)`,
  `CREATE INDEX IF NOT EXISTS actions_status_idx ON actions(status)`,
  `CREATE INDEX IF NOT EXISTS actions_verb_idx ON actions(verb)`,

  // Documents table (schema-free JSON document storage)
  `CREATE TABLE IF NOT EXISTS documents (
    "$id" TEXT PRIMARY KEY,
    "$type" TEXT NOT NULL,
    data TEXT NOT NULL,
    "$createdAt" INTEGER NOT NULL,
    "$updatedAt" INTEGER NOT NULL,
    "$version" INTEGER NOT NULL DEFAULT 1,
    "$deletedAt" INTEGER
  )`,

  // Indexes for documents table
  `CREATE INDEX IF NOT EXISTS documents_type_idx ON documents("$type")`,
  `CREATE INDEX IF NOT EXISTS documents_createdAt_idx ON documents("$createdAt")`,
  `CREATE INDEX IF NOT EXISTS documents_updatedAt_idx ON documents("$updatedAt")`,

  // FTS5 virtual table for full-text search on documents
  `CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    "$id" UNINDEXED,
    title,
    content,
    content=documents,
    content_rowid=rowid
  )`,
]

// ============================================================================
// TEST DURABLE OBJECT
// ============================================================================

/**
 * Test DO class that extends DOBase for integration testing.
 * Provides full DOBase functionality including:
 * - REST router (GET/POST/PUT/PATCH/DELETE)
 * - ThingsStore with real SQLite persistence
 * - JSON-LD response formatting
 * - Workers RPC direct method access via stub.things.create(), stub.rels.query(), etc.
 */
export class TestDO extends DO<Env> {
  static readonly $type = 'TestDO'

  private schemaInitialized = false

  // RPC wrappers - initialized lazily after schema is ready
  private _thingsRpc?: ThingsRpc
  private _relsRpc?: RelsRpc
  private _sqlRpc?: SqlRpc
  private _eventsRpc?: EventsRpc
  private _actionsRpc?: ActionsRpc
  private _documentsRpc?: DocumentsRpc

  /**
   * Direct RPC method to create a thing.
   * Flat method on DO for simpler RPC access.
   */
  async thingsCreate(data: Partial<ThingEntity> & { type?: string }): Promise<ThingEntity> {
    return this.parentThings.create(data)
  }

  /**
   * Direct RPC method to get a thing.
   */
  async thingsGet(id: string): Promise<ThingEntity | null> {
    return this.parentThings.get(id)
  }

  /**
   * Direct RPC method to list things.
   */
  async thingsList(options?: { type?: string }): Promise<ThingEntity[]> {
    return this.parentThings.list(options)
  }

  /**
   * Direct RPC method to update a thing.
   */
  async thingsUpdate(id: string, data: Partial<ThingEntity>): Promise<ThingEntity> {
    return this.parentThings.update(id, data)
  }

  /**
   * Direct RPC method to delete a thing.
   */
  async thingsDelete(id: string): Promise<ThingEntity | null> {
    try {
      return await this.parentThings.delete(id)
    } catch {
      return null
    }
  }

  /**
   * Direct RPC method to query things.
   */
  async thingsQuery(options: { type: string; where?: Record<string, unknown> }): Promise<ThingEntity[]> {
    return this.parentThings.list({
      type: options.type,
      where: options.where,
    })
  }

  /**
   * Direct RPC method to create many things.
   */
  async thingsCreateMany(items: Array<Partial<ThingEntity> & { type?: string }>): Promise<ThingEntity[]> {
    for (const item of items) {
      if (!item.$type && !item.type) {
        throw new Error('$type is required for all items')
      }
    }
    const results: ThingEntity[] = []
    for (const item of items) {
      const created = await this.parentThings.create(item)
      results.push(created)
    }
    return results
  }

  /**
   * Direct RPC method to create a relationship.
   */
  async relsCreate(data: {
    verb: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<RelationshipEntity & { $id: string }> {
    const result = await this.parentRels.create(data)
    return { ...result, $id: result.id }
  }

  /**
   * Direct RPC method to query relationships.
   */
  async relsQuery(options: {
    from?: string
    to?: string
    verb?: string
  }): Promise<Array<RelationshipEntity & { $id: string }>> {
    const results = await this.parentRels.list(options)
    return results.map((r) => ({ ...r, $id: r.id }))
  }

  /**
   * Direct RPC method to delete a relationship.
   */
  async relsDelete(id: string): Promise<void> {
    await this.parentRels.delete(id)
  }

  // =========================================================================
  // Flat Document Methods (for Workers RPC compatibility)
  // =========================================================================

  /**
   * Direct RPC method to create a document.
   */
  async documentsCreate(input: Record<string, unknown>): Promise<Document> {
    return this.getDocuments().create(input)
  }

  /**
   * Direct RPC method to get a document by ID.
   */
  async documentsGet($id: string): Promise<Document | null> {
    return this.getDocuments().get($id)
  }

  /**
   * Direct RPC method to update a document.
   */
  async documentsUpdate($id: string, updates: Record<string, unknown>): Promise<Document> {
    return this.getDocuments().update($id, updates)
  }

  /**
   * Direct RPC method to delete a document.
   */
  async documentsDelete($id: string): Promise<boolean> {
    return this.getDocuments().delete($id)
  }

  /**
   * Direct RPC method to list documents.
   */
  async documentsList(options?: ListOptions): Promise<Document[]> {
    return this.getDocuments().list(options || {})
  }

  /**
   * Direct RPC method to query documents.
   */
  async documentsQuery(options: QueryOptions): Promise<Document[]> {
    return this.getDocuments().query(options)
  }

  /**
   * Direct RPC method to search documents.
   */
  async documentsSearch(options: SearchOptions): Promise<Document[]> {
    return this.getDocuments().search(options)
  }

  /**
   * Direct RPC method to create multiple documents.
   */
  async documentsCreateMany(inputs: Record<string, unknown>[]): Promise<Document[]> {
    return this.getDocuments().createMany(inputs)
  }

  /**
   * Direct RPC method to update multiple documents.
   */
  async documentsUpdateMany(filter: QueryOptions, updates: Record<string, unknown>): Promise<number> {
    return this.getDocuments().updateMany(filter, updates)
  }

  /**
   * Direct RPC method to delete multiple documents.
   */
  async documentsDeleteMany(filter: QueryOptions): Promise<number> {
    return this.getDocuments().deleteMany(filter)
  }

  /**
   * Direct RPC method to upsert a document.
   */
  async documentsUpsert(filter: { $id: string }, data: Record<string, unknown>): Promise<Document> {
    return this.getDocuments().upsert(filter, data)
  }

  /**
   * Direct RPC method to execute SQL.
   * Supports parameterized queries with positional parameters (? placeholders).
   */
  async sqlExecute(
    query: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; changes?: number; lastInsertRowid?: number }> {
    // Use the native SQLite API directly for parameterized queries
    const storage = this.ctx.storage
    const cursor = params && params.length > 0
      ? storage.sql.exec(query, ...params)
      : storage.sql.exec(query)

    // Convert cursor to array of rows
    const rows = cursor.toArray() as Record<string, unknown>[]

    // For mutations, get the changes count
    // Note: SQLite rowsWritten is available on the cursor
    const changes = (cursor as { rowsWritten?: number }).rowsWritten

    return { rows, changes }
  }

  // Private getter for parent stores
  private get parentThings(): ThingsStore {
    const parentThings = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Object.getPrototypeOf(this)),
      'things'
    )?.get?.call(this)
    return parentThings
  }

  private get parentRels(): RelationshipsStore {
    const parentRels = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Object.getPrototypeOf(this)),
      'rels'
    )?.get?.call(this)
    return parentRels
  }

  private get parentEvents(): EventsStore {
    const parentEvents = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Object.getPrototypeOf(this)),
      'events'
    )?.get?.call(this)
    return parentEvents
  }

  private get parentActions(): ActionsStore {
    const parentActions = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Object.getPrototypeOf(this)),
      'actions'
    )?.get?.call(this)
    return parentActions
  }

  /**
   * RPC method to get the things store RpcTarget.
   * Returns an RpcTarget wrapper for ThingsStore.
   */
  getThings(): ThingsRpc {
    if (!this._thingsRpc) {
      this._thingsRpc = new ThingsRpc(this.parentThings)
    }
    return this._thingsRpc
  }

  /**
   * RPC method to get the relationships store RpcTarget.
   * Returns an RpcTarget wrapper for RelationshipsStore.
   */
  getRels(): RelsRpc {
    if (!this._relsRpc) {
      this._relsRpc = new RelsRpc(this.parentRels)
    }
    return this._relsRpc
  }

  /**
   * RPC method to get the SQL executor RpcTarget.
   * Returns an RpcTarget wrapper with execute() method.
   */
  getSql(): SqlRpc {
    if (!this._sqlRpc) {
      this._sqlRpc = new SqlRpc(this.db)
    }
    return this._sqlRpc
  }

  /**
   * RPC method to get the events store RpcTarget.
   * Returns an RpcTarget wrapper for EventsStore.
   */
  getEvents(): EventsRpc {
    if (!this._eventsRpc) {
      this._eventsRpc = new EventsRpc(this.parentEvents)
    }
    return this._eventsRpc
  }

  /**
   * RPC method to get the actions store RpcTarget.
   * Returns an RpcTarget wrapper for ActionsStore.
   */
  getActions(): ActionsRpc {
    if (!this._actionsRpc) {
      this._actionsRpc = new ActionsRpc(this.parentActions)
    }
    return this._actionsRpc
  }

  /**
   * RPC method to get the documents store RpcTarget.
   * Returns an RpcTarget wrapper for DocumentsRpc.
   */
  getDocuments(): DocumentsRpc {
    if (!this._documentsRpc) {
      this._documentsRpc = new DocumentsRpc(this.ctx.storage)
    }
    return this._documentsRpc
  }

  // Getter versions for compatibility with stub.things.create() pattern
  get things(): ThingsRpc { return this.getThings() }
  get rels(): RelsRpc { return this.getRels() }
  get sql(): SqlRpc { return this.getSql() }
  get events(): EventsRpc { return this.getEvents() }
  get actions(): ActionsRpc { return this.getActions() }
  get documents(): DocumentsRpc { return this.getDocuments() }

  /**
   * RPC-accessible $id property.
   * Returns the full identity URL based on namespace.
   */
  get $id(): string {
    return `https://${this.ns}`
  }

  /**
   * RPC method to get the namespace.
   * Note: `ns` is an instance property in DOTiny, but Workers RPC requires
   * prototype properties/methods. This method exposes ns as an RPC-callable method.
   */
  getNs(): string {
    return this.ns
  }

  /**
   * Override getRegisteredNouns to provide known nouns for testing.
   * This enables the REST router to recognize these types.
   */
  protected override getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    return [
      { noun: 'Customer', plural: 'customers' },
      { noun: 'Order', plural: 'orders' },
      { noun: 'Product', plural: 'products' },
      { noun: 'User', plural: 'users' },
      { noun: 'Item', plural: 'items' },
      { noun: 'Task', plural: 'tasks' },
      { noun: 'Person', plural: 'persons' },
      { noun: 'Company', plural: 'companies' },
      { noun: 'Investor', plural: 'investors' },
      { noun: 'Startup', plural: 'startups' },
      { noun: 'Node', plural: 'nodes' },
      { noun: 'Note', plural: 'notes' },
      { noun: 'Widget', plural: 'widgets' },
      { noun: 'ConcurrentItem', plural: 'concurrentitems' },
      { noun: 'ReadTest', plural: 'readtests' },
      { noun: 'SpecificType', plural: 'specifictypes' },
      { noun: 'TypeA', plural: 'typeas' },
      { noun: 'TypeAExtended', plural: 'typeaextendeds' },
      { noun: 'TypeB', plural: 'typebs' },
    ]
  }

  /**
   * Initialize SQLite schema on first access.
   * This creates the tables needed for ThingsStore operations.
   */
  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      // Run each schema statement
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          // Ignore "already exists" errors
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[TestDO] Schema statement failed:', err)
          }
        }
      }

      this.schemaInitialized = true
    } catch (error) {
      // Schema might already exist, that's fine
      console.error('[TestDO] Schema init error:', error)
      this.schemaInitialized = true
    }
  }

  /**
   * Ensure schema is initialized before any RPC or fetch operations.
   * Called automatically by blockConcurrencyWhile in constructor.
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize schema during construction using blockConcurrencyWhile
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
      // Also initialize ns from storage if available
      const storedNs = await ctx.storage.get<string>('ns')
      if (storedNs) {
        this._ns = storedNs
      } else {
        // Fall back to DO ID as namespace for RPC-only access
        this._ns = ctx.id.toString()
      }
    })
  }

  /**
   * Override fetch to auto-derive namespace from X-DO-NS header
   * and initialize schema on first request.
   */
  override async fetch(request: Request): Promise<Response> {
    // Schema is now initialized in constructor via blockConcurrencyWhile

    // Get ns from header - always use if provided (testing pattern)
    const headerNs = request.headers.get('X-DO-NS')
    if (headerNs) {
      this._ns = headerNs
      // Persist for future requests
      await this.ctx.storage.put('ns', headerNs)
    } else if (!this.ns) {
      // If no header and no ns, try to load from storage or use DO id
      const storedNs = await this.ctx.storage.get<string>('ns')
      if (storedNs) {
        this._ns = storedNs
      } else {
        // Use DO id as fallback
        this._ns = this.ctx.id.toString()
      }
    }

    return super.fetch(request)
  }
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

export interface TestEnv extends Env {
  TEST_DO: DurableObjectNamespace
}

/**
 * Worker entry point for DO integration tests.
 * Routes requests to the TestDO based on namespace from header or subdomain.
 */
export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    // Extract namespace from header or use default
    const ns = request.headers.get('X-DO-NS') || 'test'

    // Get DO stub by name
    const id = env.TEST_DO.idFromName(ns)
    const stub = env.TEST_DO.get(id)

    // Forward request to DO
    return stub.fetch(request)
  },
}
