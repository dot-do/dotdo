/**
 * DocumentGraphStore - GraphStore implementation with MongoDB-style document operations
 *
 * GREEN PHASE: Implements the GraphStore interface with additional document-store features:
 * - MongoDB-style query operators ($eq, $gt, $gte, $lt, $lte, $in, $nin, $regex, $exists, etc.)
 * - Batch operations (createThingsBatch, createRelationshipsBatch, bulkUpdateThings, bulkDeleteThings)
 * - Aggregation pipeline (aggregateThings, aggregateRelationships)
 * - Transaction support with rollback
 * - Index management and statistics
 *
 * @see dotdo-pyqc7 - [GREEN] DocumentGraphStore implementation
 *
 * Design:
 * - Uses better-sqlite3 for synchronous SQLite operations
 * - Stores documents as JSON in SQLite
 * - Implements query operators by translating to SQL WHERE clauses with JSON extraction
 * - Uses SQLite transactions for batch operations and rollback
 * - Tracks index metadata manually since SQLite doesn't have MongoDB-style indexes
 */

import type {
  GraphStore,
  GraphThing,
  NewGraphThing,
  GetThingsByTypeOptions,
  UpdateThingInput,
  GraphRelationship,
  CreateRelationshipInput,
  RelationshipQueryOptions,
} from '../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Index metadata for DocumentStore collections
 */
export interface IndexInfo {
  name: string
  key: Record<string, 1 | -1>
  unique?: boolean
}

/**
 * Query operators for findThings
 */
export interface QueryOperators {
  $eq?: unknown
  $gt?: number
  $gte?: number
  $lt?: number
  $lte?: number
  $in?: unknown[]
  $nin?: unknown[]
  $regex?: string
  $exists?: boolean
  $elemMatch?: QueryOperators
  $all?: unknown[]
}

/**
 * Logical operators for combining queries
 */
export interface LogicalQuery {
  $and?: Array<Record<string, QueryOperators | LogicalQuery>>
  $or?: Array<Record<string, QueryOperators | LogicalQuery>>
  [key: string]: QueryOperators | LogicalQuery | Array<Record<string, QueryOperators | LogicalQuery>> | undefined
}

/**
 * Find query options
 */
export interface FindThingsQuery {
  typeId?: number
  typeName?: string
  dataQuery?: Record<string, QueryOperators | LogicalQuery> | LogicalQuery
}

/**
 * Bulk update options
 */
export interface BulkUpdateFilter {
  typeId?: number
  typeName?: string
}

export interface BulkUpdateOperations {
  $set?: Record<string, unknown>
}

export interface BulkUpdateResult {
  modifiedCount: number
}

export interface BulkDeleteResult {
  deletedCount: number
}

/**
 * Aggregation pipeline stage types
 */
export interface MatchStage {
  $match: Record<string, unknown>
}

export interface GroupStage {
  $group: {
    _id: string
    [key: string]: { $sum: string | number } | string
  }
}

export interface SortStage {
  $sort: Record<string, 1 | -1>
}

export type AggregationStage = MatchStage | GroupStage | SortStage

/**
 * Collection statistics
 */
export interface CollectionStats {
  count: number
  nindexes: number
}

/**
 * Transaction session interface
 */
export interface TransactionSession {
  createThing(input: Omit<NewGraphThing, 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<GraphThing>
  createRelationship(input: CreateRelationshipInput): Promise<GraphRelationship>
}

/**
 * Raw relationship row from SQLite
 */
interface RelationshipRow {
  id: string
  verb: string
  from: string
  to: string
  data: string | null
  created_at: number
}

/**
 * Raw thing row from SQLite
 */
interface ThingRow {
  id: string
  type_id: number
  type_name: string
  data: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

// ============================================================================
// DocumentGraphStore Class
// ============================================================================

/**
 * DocumentGraphStore implements the GraphStore interface with MongoDB-style features.
 *
 * This implementation provides:
 * - Full GraphStore interface compatibility (same as SQLiteGraphStore)
 * - MongoDB-style query operators for rich data queries
 * - Batch operations for efficient bulk inserts/updates
 * - Aggregation pipeline support
 * - Transaction support with rollback
 *
 * @example
 * ```typescript
 * const store = new DocumentGraphStore(':memory:')
 * await store.initialize()
 *
 * // Create things
 * await store.createThing({ id: 'c1', typeId: 1, typeName: 'Customer', data: { name: 'Alice', age: 30 } })
 *
 * // Query with MongoDB-style operators
 * const results = await store.findThings({
 *   typeId: 1,
 *   dataQuery: { 'data.age': { $gte: 25 } }
 * })
 *
 * // Batch operations
 * await store.createThingsBatch([...things])
 *
 * // Aggregation
 * const stats = await store.aggregateThings([
 *   { $match: { typeName: 'Order' } },
 *   { $group: { _id: '$data.customerId', total: { $sum: '$data.amount' } } }
 * ])
 *
 * await store.close()
 * ```
 */
export class DocumentGraphStore implements GraphStore {
  private sqlite: import('better-sqlite3').Database | null = null
  private connectionPath: string

  // Index metadata
  private thingsIndexes: IndexInfo[] = [
    { name: 'idx_things_type_id', key: { typeId: 1 } },
    { name: 'idx_things_type_name', key: { typeName: 1 } },
  ]

  private relationshipsIndexes: IndexInfo[] = [
    { name: 'idx_rel_verb', key: { verb: 1 } },
    { name: 'idx_rel_from', key: { from: 1 } },
    { name: 'idx_rel_to', key: { to: 1 } },
    { name: 'idx_rel_unique', key: { verb: 1, from: 1, to: 1 }, unique: true },
  ]

  /**
   * Create a new DocumentGraphStore.
   *
   * @param connectionOrPath - SQLite connection string (':memory:' or file path)
   */
  constructor(connectionOrPath: string) {
    this.connectionPath = connectionOrPath
  }

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  /**
   * Initialize the database connection and create tables if needed.
   * Must be called before using any other methods.
   */
  async initialize(): Promise<void> {
    const BetterSqlite = (await import('better-sqlite3')).default
    this.sqlite = new BetterSqlite(this.connectionPath)

    // Create tables if they don't exist
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS graph_things (
        id TEXT PRIMARY KEY NOT NULL,
        type_id INTEGER NOT NULL,
        type_name TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_things_type_id ON graph_things(type_id);
      CREATE INDEX IF NOT EXISTS idx_things_type_name ON graph_things(type_name);
      CREATE INDEX IF NOT EXISTS idx_things_created_at ON graph_things(created_at);
      CREATE INDEX IF NOT EXISTS idx_things_deleted_at ON graph_things(deleted_at);

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY NOT NULL,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships("from");
      CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships("to");
      CREATE INDEX IF NOT EXISTS idx_rel_verb ON relationships(verb);
      CREATE INDEX IF NOT EXISTS idx_rel_from_verb ON relationships("from", verb);
      CREATE INDEX IF NOT EXISTS idx_rel_to_verb ON relationships("to", verb);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rel_unique ON relationships(verb, "from", "to");
    `)
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close()
    }
    this.sqlite = null
  }

  // =========================================================================
  // THINGS OPERATIONS (GraphStore Interface)
  // =========================================================================

  /**
   * Create a new Thing (graph node).
   */
  async createThing(
    input: Omit<NewGraphThing, 'createdAt' | 'updatedAt' | 'deletedAt'>
  ): Promise<GraphThing> {
    this.ensureInitialized()

    const now = Date.now()
    const dataJson = input.data !== undefined ? JSON.stringify(input.data) : null

    try {
      const stmt = this.sqlite!.prepare(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
      `)
      stmt.run(input.id, input.typeId, input.typeName, dataJson, now, now)

      return {
        id: input.id,
        typeId: input.typeId,
        typeName: input.typeName,
        data: input.data ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes('UNIQUE constraint failed') || error.message.includes('PRIMARY KEY'))
      ) {
        throw new Error(`Thing with ID '${input.id}' already exists`)
      }
      throw error
    }
  }

  /**
   * Get a Thing by its unique ID.
   */
  async getThing(id: string): Promise<GraphThing | null> {
    this.ensureInitialized()

    const stmt = this.sqlite!.prepare(`SELECT * FROM graph_things WHERE id = ?`)
    const row = stmt.get(id) as ThingRow | undefined

    if (!row) {
      return null
    }

    return this.rowToThing(row)
  }

  /**
   * Query Things by type with optional filtering and pagination.
   */
  async getThingsByType(options: GetThingsByTypeOptions): Promise<GraphThing[]> {
    this.ensureInitialized()

    const conditions: string[] = []
    const params: unknown[] = []

    if (options.typeId !== undefined) {
      conditions.push('type_id = ?')
      params.push(options.typeId)
    }

    if (options.typeName !== undefined) {
      conditions.push('type_name = ?')
      params.push(options.typeName)
    }

    if (!options.includeDeleted) {
      conditions.push('deleted_at IS NULL')
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Determine ordering
    const orderField = options.orderBy ?? 'createdAt'
    const orderDir = options.orderDirection ?? 'desc'
    const columnMap: Record<string, string> = {
      id: 'id',
      typeId: 'type_id',
      typeName: 'type_name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      deletedAt: 'deleted_at',
    }
    const orderColumn = columnMap[orderField] ?? 'created_at'
    const orderClause = `ORDER BY ${orderColumn} ${orderDir.toUpperCase()}`

    // Apply limit and offset
    let limitClause = ''
    if (options.limit !== undefined) {
      limitClause = `LIMIT ${options.limit}`
      if (options.offset !== undefined) {
        limitClause += ` OFFSET ${options.offset}`
      }
    } else if (options.offset !== undefined) {
      limitClause = `LIMIT -1 OFFSET ${options.offset}`
    }

    const query = `SELECT * FROM graph_things ${whereClause} ${orderClause} ${limitClause}`
    const stmt = this.sqlite!.prepare(query)
    const rows = stmt.all(...params) as ThingRow[]

    return rows.map((row) => this.rowToThing(row))
  }

  /**
   * Update a Thing's data.
   */
  async updateThing(id: string, updates: UpdateThingInput): Promise<GraphThing | null> {
    this.ensureInitialized()

    const existing = await this.getThing(id)
    if (!existing) {
      return null
    }

    const now = Date.now()
    const newData = updates.data !== undefined ? updates.data : existing.data
    const dataJson = newData !== null && newData !== undefined ? JSON.stringify(newData) : null

    const stmt = this.sqlite!.prepare(`
      UPDATE graph_things SET data = ?, updated_at = ? WHERE id = ?
    `)
    stmt.run(dataJson, now, id)

    return {
      ...existing,
      data: newData,
      updatedAt: now,
    }
  }

  /**
   * Soft delete a Thing by setting its deletedAt timestamp.
   */
  async deleteThing(id: string): Promise<GraphThing | null> {
    this.ensureInitialized()

    const existing = await this.getThing(id)
    if (!existing) {
      return null
    }

    const now = Date.now()

    const stmt = this.sqlite!.prepare(`
      UPDATE graph_things SET deleted_at = ? WHERE id = ?
    `)
    stmt.run(now, id)

    return {
      ...existing,
      deletedAt: now,
    }
  }

  // =========================================================================
  // BATCH THINGS OPERATIONS (N+1 elimination)
  // =========================================================================

  /**
   * Default chunk size for SQL IN clause to avoid SQLite limits.
   * SQLite has a default SQLITE_MAX_VARIABLE_NUMBER of 999.
   */
  private static readonly BATCH_CHUNK_SIZE = 500

  /**
   * Get multiple Things by their IDs in a single query.
   * Returns a Map for O(1) lookup by ID.
   *
   * Uses SQL IN clause for efficient bulk fetch.
   * Chunks large arrays to avoid SQLite variable limits.
   */
  async getThings(ids: string[]): Promise<Map<string, GraphThing>> {
    this.ensureInitialized()

    // Handle empty array gracefully
    if (ids.length === 0) {
      return new Map()
    }

    const resultMap = new Map<string, GraphThing>()

    // Chunk the IDs to avoid SQLite variable limits
    for (let i = 0; i < ids.length; i += DocumentGraphStore.BATCH_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + DocumentGraphStore.BATCH_CHUNK_SIZE)

      // Build parameterized query with IN clause
      const placeholders = chunk.map(() => '?').join(', ')
      const query = `SELECT * FROM graph_things WHERE id IN (${placeholders})`

      const stmt = this.sqlite!.prepare(query)
      const results = stmt.all(...chunk) as ThingRow[]

      for (const row of results) {
        const thing = this.rowToThing(row)
        resultMap.set(thing.id, thing)
      }
    }

    return resultMap
  }

  /**
   * Get multiple Things by their IDs, preserving order.
   * Returns an array in the same order as input IDs.
   * Missing IDs return null at their position.
   *
   * Uses SQL IN clause for efficient bulk fetch.
   * Chunks large arrays to avoid SQLite variable limits.
   */
  async getThingsByIds(ids: string[]): Promise<(GraphThing | null)[]> {
    this.ensureInitialized()

    // Handle empty array gracefully
    if (ids.length === 0) {
      return []
    }

    // Fetch all things as a map
    const thingsMap = await this.getThings(ids)

    // Return in order, with null for missing IDs
    return ids.map((id) => thingsMap.get(id) ?? null)
  }

  // =========================================================================
  // RELATIONSHIPS OPERATIONS (GraphStore Interface)
  // =========================================================================

  /**
   * Create a new Relationship (graph edge).
   */
  async createRelationship(input: CreateRelationshipInput): Promise<GraphRelationship> {
    this.ensureInitialized()

    const now = Date.now()
    const dataJson = input.data ? JSON.stringify(input.data) : null

    try {
      const stmt = this.sqlite!.prepare(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      stmt.run(input.id, input.verb, input.from, input.to, dataJson, now)

      return {
        id: input.id,
        verb: input.verb,
        from: input.from,
        to: input.to,
        data: input.data ? (input.data as Record<string, unknown>) : null,
        createdAt: new Date(now),
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(
          `Relationship with (verb='${input.verb}', from='${input.from}', to='${input.to}') already exists`
        )
      }
      throw error
    }
  }

  /**
   * Query relationships by source URL (forward graph traversal).
   */
  async queryRelationshipsFrom(
    url: string,
    options?: RelationshipQueryOptions
  ): Promise<GraphRelationship[]> {
    this.ensureInitialized()

    let query = `SELECT * FROM relationships WHERE "from" = ?`
    const params: string[] = [url]

    if (options?.verb) {
      query += ` AND verb = ?`
      params.push(options.verb)
    }

    const stmt = this.sqlite!.prepare(query)
    const results = stmt.all(...params) as RelationshipRow[]

    return results.map(this.rowToRelationship)
  }

  /**
   * Query relationships by target URL (backward graph traversal).
   */
  async queryRelationshipsTo(
    url: string,
    options?: RelationshipQueryOptions
  ): Promise<GraphRelationship[]> {
    this.ensureInitialized()

    let query = `SELECT * FROM relationships WHERE "to" = ?`
    const params: string[] = [url]

    if (options?.verb) {
      query += ` AND verb = ?`
      params.push(options.verb)
    }

    const stmt = this.sqlite!.prepare(query)
    const results = stmt.all(...params) as RelationshipRow[]

    return results.map(this.rowToRelationship)
  }

  /**
   * Query all relationships with a specific verb.
   */
  async queryRelationshipsByVerb(verb: string): Promise<GraphRelationship[]> {
    this.ensureInitialized()

    const stmt = this.sqlite!.prepare(`SELECT * FROM relationships WHERE verb = ?`)
    const results = stmt.all(verb) as RelationshipRow[]

    return results.map(this.rowToRelationship)
  }

  /**
   * Delete a relationship by its ID.
   */
  async deleteRelationship(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = this.sqlite!.prepare(`DELETE FROM relationships WHERE id = ?`).run(id)

    return result.changes > 0
  }

  // =========================================================================
  // BATCH RELATIONSHIPS OPERATIONS (N+1 elimination)
  // =========================================================================

  /**
   * Query relationships from multiple source URLs in a single query.
   * Eliminates N+1 queries when traversing from multiple nodes.
   *
   * Uses SQL IN clause for efficient bulk fetch.
   * Chunks large arrays to avoid SQLite variable limits.
   */
  async queryRelationshipsFromMany(
    urls: string[],
    options?: RelationshipQueryOptions
  ): Promise<GraphRelationship[]> {
    this.ensureInitialized()

    // Handle empty array gracefully
    if (urls.length === 0) {
      return []
    }

    const allResults: GraphRelationship[] = []

    // Chunk the URLs to avoid SQLite variable limits
    for (let i = 0; i < urls.length; i += DocumentGraphStore.BATCH_CHUNK_SIZE) {
      const chunk = urls.slice(i, i + DocumentGraphStore.BATCH_CHUNK_SIZE)

      // Build parameterized query with IN clause
      const placeholders = chunk.map(() => '?').join(', ')
      let query = `SELECT * FROM relationships WHERE "from" IN (${placeholders})`
      const params: string[] = [...chunk]

      if (options?.verb) {
        query += ` AND verb = ?`
        params.push(options.verb)
      }

      const stmt = this.sqlite!.prepare(query)
      const results = stmt.all(...params) as RelationshipRow[]

      allResults.push(...results.map(this.rowToRelationship))
    }

    return allResults
  }

  // =========================================================================
  // DOCUMENTSTORE-SPECIFIC: INDEX MANAGEMENT
  // =========================================================================

  /**
   * Get index metadata for the Things collection.
   */
  async getThingsIndexes(): Promise<IndexInfo[]> {
    return this.thingsIndexes
  }

  /**
   * Get index metadata for the Relationships collection.
   */
  async getRelationshipsIndexes(): Promise<IndexInfo[]> {
    return this.relationshipsIndexes
  }

  // =========================================================================
  // DOCUMENTSTORE-SPECIFIC: FIND WITH QUERY OPERATORS
  // =========================================================================

  /**
   * Find Things using MongoDB-style query operators.
   *
   * Supports:
   * - $eq, $gt, $gte, $lt, $lte: Comparison operators
   * - $in, $nin: Array membership operators
   * - $regex: Pattern matching
   * - $exists: Field existence check
   * - $elemMatch: Array element matching
   * - $all: All elements must match
   * - $and, $or: Logical operators
   *
   * @param query - Query options with data filters
   * @returns Array of matching Things
   */
  async findThings(query: FindThingsQuery): Promise<GraphThing[]> {
    this.ensureInitialized()

    // Get base results from type filter
    const baseResults = await this.getThingsByType({
      typeId: query.typeId,
      typeName: query.typeName,
      includeDeleted: false,
    })

    if (!query.dataQuery) {
      return baseResults
    }

    // Apply data query filters in JavaScript
    return baseResults.filter((thing) => this.matchesQuery(thing, query.dataQuery!))
  }

  /**
   * Check if a thing matches a query.
   */
  private matchesQuery(
    thing: GraphThing,
    query: Record<string, QueryOperators | LogicalQuery> | LogicalQuery
  ): boolean {
    // Handle $and operator
    if ('$and' in query && Array.isArray(query.$and)) {
      return query.$and.every((subQuery) => this.matchesQuery(thing, subQuery as Record<string, QueryOperators | LogicalQuery>))
    }

    // Handle $or operator
    if ('$or' in query && Array.isArray(query.$or)) {
      return query.$or.some((subQuery) => this.matchesQuery(thing, subQuery as Record<string, QueryOperators | LogicalQuery>))
    }

    // Handle field-level queries
    for (const [field, operators] of Object.entries(query)) {
      if (field === '$and' || field === '$or') continue

      const value = this.getNestedValue(thing, field)

      if (!this.matchesOperators(value, operators as QueryOperators)) {
        return false
      }
    }

    return true
  }

  /**
   * Get a nested value from an object using dot notation.
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }

    return current
  }

  /**
   * Check if a value matches query operators.
   */
  private matchesOperators(value: unknown, operators: QueryOperators): boolean {
    for (const [op, operand] of Object.entries(operators)) {
      switch (op) {
        case '$eq':
          if (value !== operand) return false
          break

        case '$gt':
          if (typeof value !== 'number' || value <= (operand as number)) return false
          break

        case '$gte':
          if (typeof value !== 'number' || value < (operand as number)) return false
          break

        case '$lt':
          if (typeof value !== 'number' || value >= (operand as number)) return false
          break

        case '$lte':
          if (typeof value !== 'number' || value > (operand as number)) return false
          break

        case '$in':
          if (!Array.isArray(operand) || !operand.includes(value)) return false
          break

        case '$nin':
          if (!Array.isArray(operand) || operand.includes(value)) return false
          break

        case '$regex':
          if (typeof value !== 'string' || !new RegExp(operand as string).test(value)) return false
          break

        case '$exists':
          if (operand === true && value === undefined) return false
          if (operand === false && value !== undefined) return false
          break

        case '$elemMatch':
          if (!Array.isArray(value)) return false
          if (!value.some((elem) => this.matchesOperators(elem, operand as QueryOperators))) return false
          break

        case '$all':
          if (!Array.isArray(value) || !Array.isArray(operand)) return false
          if (!operand.every((required) => value.includes(required))) return false
          break
      }
    }

    return true
  }

  // =========================================================================
  // DOCUMENTSTORE-SPECIFIC: BATCH OPERATIONS
  // =========================================================================

  /**
   * Create multiple Things in a single batch operation.
   * Uses a transaction to ensure atomicity - all succeed or all fail.
   */
  async createThingsBatch(
    things: Array<Omit<NewGraphThing, 'createdAt' | 'updatedAt' | 'deletedAt'>>
  ): Promise<GraphThing[]> {
    this.ensureInitialized()

    const results: GraphThing[] = []
    const now = Date.now()

    const stmt = this.sqlite!.prepare(`
      INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `)

    const transaction = this.sqlite!.transaction(() => {
      for (const input of things) {
        const dataJson = input.data !== undefined ? JSON.stringify(input.data) : null
        stmt.run(input.id, input.typeId, input.typeName, dataJson, now, now)

        results.push({
          id: input.id,
          typeId: input.typeId,
          typeName: input.typeName,
          data: input.data ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
      }
    })

    try {
      transaction()
      return results
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes('UNIQUE constraint failed') || error.message.includes('PRIMARY KEY'))
      ) {
        throw new Error(`Batch creation failed: duplicate ID found`)
      }
      throw error
    }
  }

  /**
   * Create multiple Relationships in a single batch operation.
   * Uses a transaction to ensure atomicity - all succeed or all fail.
   */
  async createRelationshipsBatch(
    relationships: CreateRelationshipInput[]
  ): Promise<GraphRelationship[]> {
    this.ensureInitialized()

    const results: GraphRelationship[] = []
    const now = Date.now()

    const stmt = this.sqlite!.prepare(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.sqlite!.transaction(() => {
      for (const input of relationships) {
        const dataJson = input.data ? JSON.stringify(input.data) : null
        stmt.run(input.id, input.verb, input.from, input.to, dataJson, now)

        results.push({
          id: input.id,
          verb: input.verb,
          from: input.from,
          to: input.to,
          data: input.data ? (input.data as Record<string, unknown>) : null,
          createdAt: new Date(now),
        })
      }
    })

    try {
      transaction()
      return results
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`Batch creation failed: duplicate relationship found`)
      }
      throw error
    }
  }

  /**
   * Bulk update Things matching a filter.
   */
  async bulkUpdateThings(
    filter: BulkUpdateFilter,
    operations: BulkUpdateOperations
  ): Promise<BulkUpdateResult> {
    this.ensureInitialized()

    // Get matching things
    const things = await this.getThingsByType({
      typeId: filter.typeId,
      typeName: filter.typeName,
      includeDeleted: false,
    })

    if (things.length === 0) {
      return { modifiedCount: 0 }
    }

    const now = Date.now()
    let modifiedCount = 0

    const updateStmt = this.sqlite!.prepare(`
      UPDATE graph_things SET data = ?, updated_at = ? WHERE id = ?
    `)

    const transaction = this.sqlite!.transaction(() => {
      for (const thing of things) {
        let newData = thing.data ?? {}

        if (operations.$set) {
          for (const [path, value] of Object.entries(operations.$set)) {
            // Strip 'data.' prefix if present since we're already operating on the data field
            const normalizedPath = path.startsWith('data.') ? path.slice(5) : path
            newData = this.setNestedValue(newData as Record<string, unknown>, normalizedPath, value)
          }
        }

        const dataJson = JSON.stringify(newData)
        updateStmt.run(dataJson, now, thing.id)
        modifiedCount++
      }
    })

    transaction()

    return { modifiedCount }
  }

  /**
   * Set a nested value in an object using dot notation.
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
    const result = { ...obj }
    const parts = path.split('.')
    let current: Record<string, unknown> = result

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    current[parts[parts.length - 1]!] = value
    return result
  }

  /**
   * Bulk soft-delete Things matching a filter.
   */
  async bulkDeleteThings(filter: BulkUpdateFilter): Promise<BulkDeleteResult> {
    this.ensureInitialized()

    // Get matching things
    const things = await this.getThingsByType({
      typeId: filter.typeId,
      typeName: filter.typeName,
      includeDeleted: false,
    })

    if (things.length === 0) {
      return { deletedCount: 0 }
    }

    const now = Date.now()
    const updateStmt = this.sqlite!.prepare(`
      UPDATE graph_things SET deleted_at = ? WHERE id = ?
    `)

    const transaction = this.sqlite!.transaction(() => {
      for (const thing of things) {
        updateStmt.run(now, thing.id)
      }
    })

    transaction()

    return { deletedCount: things.length }
  }

  // =========================================================================
  // DOCUMENTSTORE-SPECIFIC: AGGREGATION PIPELINE
  // =========================================================================

  /**
   * Run an aggregation pipeline on Things.
   *
   * Supports:
   * - $match: Filter documents
   * - $group: Group by field with aggregation operators
   * - $sort: Sort results
   */
  async aggregateThings(pipeline: AggregationStage[]): Promise<Array<Record<string, unknown>>> {
    this.ensureInitialized()

    // Get all things (we'll filter in memory)
    const allThings = await this.getThingsByType({ includeDeleted: false })

    let results: Array<Record<string, unknown>> = allThings.map((t) => ({
      id: t.id,
      typeId: t.typeId,
      typeName: t.typeName,
      data: t.data,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      deletedAt: t.deletedAt,
    }))

    for (const stage of pipeline) {
      if ('$match' in stage) {
        results = this.applyMatch(results, stage.$match)
      } else if ('$group' in stage) {
        results = this.applyGroup(results, stage.$group)
      } else if ('$sort' in stage) {
        results = this.applySort(results, stage.$sort)
      }
    }

    return results
  }

  /**
   * Run an aggregation pipeline on Relationships.
   */
  async aggregateRelationships(pipeline: AggregationStage[]): Promise<Array<Record<string, unknown>>> {
    this.ensureInitialized()

    // Get all relationships
    const stmt = this.sqlite!.prepare(`SELECT * FROM relationships`)
    const rows = stmt.all() as RelationshipRow[]

    let results: Array<Record<string, unknown>> = rows.map((r) => ({
      id: r.id,
      verb: r.verb,
      from: r.from,
      to: r.to,
      data: r.data ? JSON.parse(r.data) : null,
      createdAt: new Date(r.created_at),
    }))

    for (const stage of pipeline) {
      if ('$match' in stage) {
        results = this.applyMatch(results, stage.$match)
      } else if ('$group' in stage) {
        results = this.applyGroup(results, stage.$group)
      } else if ('$sort' in stage) {
        results = this.applySort(results, stage.$sort)
      }
    }

    return results
  }

  /**
   * Apply $match stage to results.
   */
  private applyMatch(
    results: Array<Record<string, unknown>>,
    match: Record<string, unknown>
  ): Array<Record<string, unknown>> {
    return results.filter((doc) => {
      for (const [key, value] of Object.entries(match)) {
        const docValue = this.getNestedValue(doc, key)
        if (docValue !== value) {
          return false
        }
      }
      return true
    })
  }

  /**
   * Apply $group stage to results.
   */
  private applyGroup(
    results: Array<Record<string, unknown>>,
    group: { _id: string; [key: string]: { $sum: string | number } | string }
  ): Array<Record<string, unknown>> {
    const groups = new Map<unknown, Record<string, unknown>>()

    for (const doc of results) {
      const groupKey = group._id.startsWith('$')
        ? this.getNestedValue(doc, group._id.slice(1))
        : group._id

      if (!groups.has(groupKey)) {
        groups.set(groupKey, { _id: groupKey })
      }

      const groupDoc = groups.get(groupKey)!

      for (const [field, aggOp] of Object.entries(group)) {
        if (field === '_id') continue

        if (typeof aggOp === 'object' && '$sum' in aggOp) {
          const sumValue = aggOp.$sum
          let addValue: number

          if (typeof sumValue === 'number') {
            addValue = sumValue
          } else if (typeof sumValue === 'string' && sumValue.startsWith('$')) {
            const fieldValue = this.getNestedValue(doc, sumValue.slice(1))
            addValue = typeof fieldValue === 'number' ? fieldValue : 0
          } else {
            addValue = 0
          }

          groupDoc[field] = ((groupDoc[field] as number) || 0) + addValue
        }
      }
    }

    return Array.from(groups.values())
  }

  /**
   * Apply $sort stage to results.
   */
  private applySort(
    results: Array<Record<string, unknown>>,
    sort: Record<string, 1 | -1>
  ): Array<Record<string, unknown>> {
    return [...results].sort((a, b) => {
      for (const [field, direction] of Object.entries(sort)) {
        const aVal = a[field]
        const bVal = b[field]

        if (aVal === bVal) continue

        if (aVal === null || aVal === undefined) return direction
        if (bVal === null || bVal === undefined) return -direction

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return direction * (aVal - bVal)
        }

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return direction * aVal.localeCompare(bVal)
        }

        return 0
      }
      return 0
    })
  }

  // =========================================================================
  // DOCUMENTSTORE-SPECIFIC: TRANSACTION SUPPORT
  // =========================================================================

  /**
   * Execute operations within a transaction.
   * All operations succeed or all are rolled back.
   */
  async transaction(callback: (session: TransactionSession) => Promise<void>): Promise<void> {
    this.ensureInitialized()

    const session: TransactionSession = {
      createThing: async (input) => {
        const now = Date.now()
        const dataJson = input.data !== undefined ? JSON.stringify(input.data) : null

        const stmt = this.sqlite!.prepare(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL)
        `)
        stmt.run(input.id, input.typeId, input.typeName, dataJson, now, now)

        return {
          id: input.id,
          typeId: input.typeId,
          typeName: input.typeName,
          data: input.data ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        }
      },

      createRelationship: async (input) => {
        const now = Date.now()
        const dataJson = input.data ? JSON.stringify(input.data) : null

        const stmt = this.sqlite!.prepare(`
          INSERT INTO relationships (id, verb, "from", "to", data, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        stmt.run(input.id, input.verb, input.from, input.to, dataJson, now)

        return {
          id: input.id,
          verb: input.verb,
          from: input.from,
          to: input.to,
          data: input.data ? (input.data as Record<string, unknown>) : null,
          createdAt: new Date(now),
        }
      },
    }

    const transaction = this.sqlite!.transaction(() => {
      // We need to run the async callback synchronously in SQLite transactions
      // This is a limitation - we'll run callback operations directly
    })

    // Start a SAVEPOINT for manual transaction control
    this.sqlite!.exec('BEGIN TRANSACTION')

    try {
      await callback(session)
      this.sqlite!.exec('COMMIT')
    } catch (error) {
      this.sqlite!.exec('ROLLBACK')
      throw error
    }
  }

  // =========================================================================
  // DOCUMENTSTORE-SPECIFIC: COLLECTION STATISTICS
  // =========================================================================

  /**
   * Get statistics about the Things collection.
   */
  async getThingsStats(): Promise<CollectionStats> {
    this.ensureInitialized()

    const countResult = this.sqlite!.prepare(
      `SELECT COUNT(*) as count FROM graph_things WHERE deleted_at IS NULL`
    ).get() as { count: number }

    const indexResult = this.sqlite!.prepare(
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'index' AND tbl_name = 'graph_things'`
    ).get() as { count: number }

    return {
      count: countResult.count,
      nindexes: indexResult.count,
    }
  }

  /**
   * Get statistics about the Relationships collection.
   */
  async getRelationshipsStats(): Promise<CollectionStats> {
    this.ensureInitialized()

    const countResult = this.sqlite!.prepare(`SELECT COUNT(*) as count FROM relationships`).get() as {
      count: number
    }

    const indexResult = this.sqlite!.prepare(
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'index' AND tbl_name = 'relationships'`
    ).get() as { count: number }

    return {
      count: countResult.count,
      nindexes: indexResult.count,
    }
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  /**
   * Ensure the database is initialized.
   */
  private ensureInitialized(): void {
    if (!this.sqlite) {
      throw new Error('DocumentGraphStore not initialized. Call initialize() first.')
    }
  }

  /**
   * Convert a database row to a GraphThing.
   */
  private rowToThing(row: ThingRow): GraphThing {
    let data: Record<string, unknown> | null = null
    if (row.data) {
      try {
        data = JSON.parse(row.data) as Record<string, unknown>
      } catch {
        data = null
      }
    }

    return {
      id: row.id,
      typeId: row.type_id,
      typeName: row.type_name,
      data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }
  }

  /**
   * Convert a raw database row to a GraphRelationship.
   */
  private rowToRelationship = (row: RelationshipRow): GraphRelationship => {
    let data: Record<string, unknown> | null = null
    if (row.data) {
      try {
        data = JSON.parse(row.data) as Record<string, unknown>
      } catch {
        data = null
      }
    }

    return {
      id: row.id,
      verb: row.verb,
      from: row.from,
      to: row.to,
      data,
      createdAt: new Date(row.created_at),
    }
  }
}
