/**
 * SQLiteGraphStore - Concrete GraphStore implementation using SQLite
 *
 * GREEN PHASE: Implements the GraphStore interface to pass all tests
 * defined in db/graph/tests/graph-store.test.ts.
 *
 * @see dotdo-5jko1 - [GREEN] SQLiteGraphStore - Concrete implementation
 *
 * Design:
 * - Uses better-sqlite3 for synchronous SQLite operations
 * - Wraps existing Things and Relationships implementations
 * - Supports both in-memory (:memory:) and file-based databases
 * - Uses Drizzle ORM for schema and query building
 */

import { drizzle as drizzleBetterSqlite } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq, and, isNull, desc, asc } from 'drizzle-orm'
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
import { graphThings } from '../things'
import { graphRelationships } from '../relationships'

// ============================================================================
// SQLiteGraphStore Class
// ============================================================================

/**
 * SQLiteGraphStore implements the GraphStore interface using SQLite.
 *
 * This is a concrete implementation that can be used for:
 * - Unit testing with in-memory databases
 * - Local development with file-based databases
 * - Production use in Durable Objects (via drizzle-orm/durable-sqlite)
 *
 * @example
 * ```typescript
 * // In-memory database for testing
 * const store = new SQLiteGraphStore(':memory:')
 * await store.initialize()
 *
 * // Create a Thing
 * const customer = await store.createThing({
 *   id: 'customer-1',
 *   typeId: 1,
 *   typeName: 'Customer',
 *   data: { name: 'Alice' }
 * })
 *
 * // Create a Relationship
 * const rel = await store.createRelationship({
 *   id: 'rel-1',
 *   verb: 'owns',
 *   from: 'do://tenant/customers/alice',
 *   to: 'do://tenant/products/widget'
 * })
 *
 * // Query relationships
 * const rels = await store.queryRelationshipsFrom('do://tenant/customers/alice')
 *
 * // Clean up
 * await store.close()
 * ```
 */
export class SQLiteGraphStore implements GraphStore {
  private sqlite: import('better-sqlite3').Database | null = null
  private db: BetterSQLite3Database | null = null
  private connectionPath: string

  /**
   * Create a new SQLiteGraphStore.
   *
   * @param connectionOrPath - SQLite connection string (':memory:' or file path)
   *                           or an existing better-sqlite3 database instance
   */
  constructor(connectionOrPath: string | import('better-sqlite3').Database) {
    if (typeof connectionOrPath === 'string') {
      this.connectionPath = connectionOrPath
    } else {
      this.sqlite = connectionOrPath
      this.connectionPath = ':existing:'
    }
  }

  /**
   * Initialize the database connection and create tables if needed.
   * Must be called before using any other methods.
   */
  async initialize(): Promise<void> {
    // Dynamically import better-sqlite3 to support environments where it's not available
    const BetterSqlite = (await import('better-sqlite3')).default

    if (!this.sqlite) {
      this.sqlite = new BetterSqlite(this.connectionPath)
    }

    this.db = drizzleBetterSqlite(this.sqlite)

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

      CREATE INDEX IF NOT EXISTS graph_things_type_id_idx ON graph_things(type_id);
      CREATE INDEX IF NOT EXISTS graph_things_type_name_idx ON graph_things(type_name);
      CREATE INDEX IF NOT EXISTS graph_things_created_at_idx ON graph_things(created_at);
      CREATE INDEX IF NOT EXISTS graph_things_deleted_at_idx ON graph_things(deleted_at);

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY NOT NULL,
        verb TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS rel_from_idx ON relationships("from");
      CREATE INDEX IF NOT EXISTS rel_to_idx ON relationships("to");
      CREATE INDEX IF NOT EXISTS rel_verb_idx ON relationships(verb);
      CREATE INDEX IF NOT EXISTS rel_from_verb_idx ON relationships("from", verb);
      CREATE INDEX IF NOT EXISTS rel_to_verb_idx ON relationships("to", verb);
      CREATE UNIQUE INDEX IF NOT EXISTS rel_unique_idx ON relationships(verb, "from", "to");
    `)
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    if (this.sqlite && this.connectionPath !== ':existing:') {
      this.sqlite.close()
    }
    this.sqlite = null
    this.db = null
  }

  // =========================================================================
  // THINGS OPERATIONS
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
      const result = this.db!.insert(graphThings)
        .values({
          id: input.id,
          typeId: input.typeId,
          typeName: input.typeName,
          data: input.data ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .returning()
        .get()

      return this.rowToThing(result)
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

    const result = this.db!.select().from(graphThings).where(eq(graphThings.id, id)).get()

    if (!result) {
      return null
    }

    return this.rowToThing(result)
  }

  /**
   * Query Things by type with optional filtering and pagination.
   */
  async getThingsByType(options: GetThingsByTypeOptions): Promise<GraphThing[]> {
    this.ensureInitialized()

    // Build conditions array
    const conditions = []

    if (options.typeId !== undefined) {
      conditions.push(eq(graphThings.typeId, options.typeId))
    }

    if (options.typeName !== undefined) {
      conditions.push(eq(graphThings.typeName, options.typeName))
    }

    // Exclude deleted by default
    if (!options.includeDeleted) {
      conditions.push(isNull(graphThings.deletedAt))
    }

    // Build query
    let query = this.db!.select().from(graphThings)

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query
    }

    // Determine ordering
    const orderField = options.orderBy ?? 'createdAt'
    const orderDir = options.orderDirection ?? 'desc'

    // Map orderBy string to column
    const orderColumn = this.getOrderColumn(orderField)
    if (orderColumn) {
      query = query.orderBy(orderDir === 'asc' ? asc(orderColumn) : desc(orderColumn)) as typeof query
    }

    // Apply limit and offset
    // SQLite requires LIMIT when using OFFSET, so use a large number if no limit specified
    if (options.offset !== undefined && options.limit === undefined) {
      query = query.limit(999999999) as typeof query
    } else if (options.limit !== undefined) {
      query = query.limit(options.limit) as typeof query
    }

    if (options.offset !== undefined) {
      query = query.offset(options.offset) as typeof query
    }

    const results = query.all()

    return results.map((row) => this.rowToThing(row))
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

    const result = this.db!.update(graphThings)
      .set({
        data: updates.data !== undefined ? updates.data : existing.data,
        updatedAt: now,
      })
      .where(eq(graphThings.id, id))
      .returning()
      .get()

    if (!result) {
      return null
    }

    return this.rowToThing(result)
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

    const result = this.db!.update(graphThings)
      .set({
        deletedAt: now,
      })
      .where(eq(graphThings.id, id))
      .returning()
      .get()

    if (!result) {
      return null
    }

    return this.rowToThing(result)
  }

  // =========================================================================
  // RELATIONSHIPS OPERATIONS
  // =========================================================================

  /**
   * Create a new Relationship (graph edge).
   */
  async createRelationship(input: CreateRelationshipInput): Promise<GraphRelationship> {
    this.ensureInitialized()

    const now = Date.now()
    const dataJson = input.data ? JSON.stringify(input.data) : null

    try {
      this.sqlite!.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES (
          '${input.id.replace(/'/g, "''")}',
          '${input.verb.replace(/'/g, "''")}',
          '${input.from.replace(/'/g, "''")}',
          '${input.to.replace(/'/g, "''")}',
          ${dataJson ? `'${dataJson.replace(/'/g, "''")}'` : 'NULL'},
          ${now}
        )
      `)

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
        throw new Error(`Relationship with (verb='${input.verb}', from='${input.from}', to='${input.to}') already exists`)
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
  // PRIVATE HELPERS
  // =========================================================================

  /**
   * Ensure the database is initialized.
   */
  private ensureInitialized(): void {
    if (!this.db || !this.sqlite) {
      throw new Error('SQLiteGraphStore not initialized. Call initialize() first.')
    }
  }

  /**
   * Get the Drizzle column for ordering.
   */
  private getOrderColumn(field: string) {
    switch (field) {
      case 'id':
        return graphThings.id
      case 'typeId':
        return graphThings.typeId
      case 'typeName':
        return graphThings.typeName
      case 'createdAt':
        return graphThings.createdAt
      case 'updatedAt':
        return graphThings.updatedAt
      case 'deletedAt':
        return graphThings.deletedAt
      default:
        return graphThings.createdAt
    }
  }

  /**
   * Convert a database row to a GraphThing.
   */
  private rowToThing(row: typeof graphThings.$inferSelect): GraphThing {
    return {
      id: row.id,
      typeId: row.typeId,
      typeName: row.typeName,
      data: row.data,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
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

// ============================================================================
// TYPES
// ============================================================================

/**
 * Raw relationship row from SQLite.
 */
interface RelationshipRow {
  id: string
  verb: string
  from: string
  to: string
  data: string | null
  created_at: number
}
