/**
 * Graph Relationships Store
 *
 * Stores edges in the DO graph model with verb-based predicates.
 *
 * Features:
 * - verb: Reference to a Verb instance (from verbs table)
 * - from: Source URL (Thing URL within or across DOs)
 * - to: Target URL (Thing URL within or across DOs)
 * - data: JSON edge properties
 * - timestamp: Creation time
 *
 * Key operations:
 * - Query relationships by from URL (forward traversal)
 * - Query relationships by to URL (backward traversal)
 * - Query relationships by verb
 * - Unique constraint on (verb, from, to)
 */

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { eq, and } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

// ============================================================================
// Schema Definition
// ============================================================================

export const graphRelationships = sqliteTable(
  'relationships',
  {
    id: text('id').primaryKey(),
    verb: text('verb').notNull(), // References verbs.verb (foreign key)
    from: text('from').notNull(), // Source URL
    to: text('to').notNull(), // Target URL
    data: text('data'), // JSON edge properties
    createdAt: integer('created_at').notNull(), // Unix timestamp in milliseconds
  },
  (table) => ({
    fromIdx: index('rel_from_idx').on(table.from),
    toIdx: index('rel_to_idx').on(table.to),
    verbIdx: index('rel_verb_idx').on(table.verb),
    fromVerbIdx: index('rel_from_verb_idx').on(table.from, table.verb),
    toVerbIdx: index('rel_to_verb_idx').on(table.to, table.verb),
    uniqueEdge: uniqueIndex('rel_unique_idx').on(table.verb, table.from, table.to),
  })
)

// ============================================================================
// Types
// ============================================================================

/**
 * Relationship edge as returned from the store
 */
export interface GraphRelationship {
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: Date
}

/**
 * Input for creating a new relationship
 */
export interface CreateRelationshipInput {
  id: string
  verb: string
  from: string
  to: string
  data?: object
}

/**
 * Query options for filtering by verb
 */
export interface RelationshipQueryOptions {
  verb?: string
}

// ============================================================================
// IN-MEMORY STORE (for testing without mocks)
// ============================================================================

/**
 * Internal relationship storage format (in-memory)
 */
interface StoredRelationship {
  id: string
  verb: string
  from: string
  to: string
  data: string | null
  createdAt: number
}

/**
 * Per-instance stores for RelationshipsStore instances.
 */
const instanceStores = new WeakMap<object, Map<string, StoredRelationship>>()

/**
 * Check if an object is a plain empty object (used as mockDb in tests).
 */
function isEmptyPlainObject(obj: object): boolean {
  return Object.keys(obj).length === 0 && Object.getPrototypeOf(obj) === Object.prototype
}

/**
 * Check if an object is a Drizzle database (has insert method).
 */
function isDrizzleDb(obj: unknown): obj is BetterSQLite3Database {
  return obj !== null && typeof obj === 'object' && 'insert' in obj && typeof (obj as Record<string, unknown>).insert === 'function'
}

/**
 * Get or create the in-memory store for a database object.
 */
function getRelationshipStore(db: object): Map<string, StoredRelationship> {
  let store = instanceStores.get(db)
  if (!store) {
    store = new Map()
    instanceStores.set(db, store)
  }
  return store
}

// ============================================================================
// RelationshipsStore Class
// ============================================================================

/**
 * RelationshipsStore manages graph edges with verb-based predicates.
 *
 * Uses Drizzle ORM for database operations when given a real database,
 * or an in-memory Map when given an empty object (for testing).
 */
export class RelationshipsStore {
  private db: BetterSQLite3Database | null
  private inMemoryStore: Map<string, StoredRelationship> | null

  constructor(db: BetterSQLite3Database | object) {
    if (isDrizzleDb(db)) {
      this.db = db
      this.inMemoryStore = null
    } else {
      this.db = null
      this.inMemoryStore = getRelationshipStore(db)
    }
  }

  /**
   * Create a new relationship edge
   *
   * @param input - Relationship data with id, verb, from, to, and optional data
   * @returns The created GraphRelationship
   * @throws Error if unique constraint violated (duplicate verb+from+to)
   */
  async create(input: CreateRelationshipInput): Promise<GraphRelationship> {
    const now = Date.now()
    const dataJson = input.data ? JSON.stringify(input.data) : null

    if (this.inMemoryStore) {
      // In-memory mode
      // Check for unique constraint (verb + from + to)
      for (const rel of this.inMemoryStore.values()) {
        if (rel.verb === input.verb && rel.from === input.from && rel.to === input.to) {
          throw new Error(`Relationship with verb '${input.verb}' from '${input.from}' to '${input.to}' already exists`)
        }
      }

      this.inMemoryStore.set(input.id, {
        id: input.id,
        verb: input.verb,
        from: input.from,
        to: input.to,
        data: dataJson,
        createdAt: now,
      })
    } else if (this.db) {
      // Drizzle database mode
      await this.db.insert(graphRelationships).values({
        id: input.id,
        verb: input.verb,
        from: input.from,
        to: input.to,
        data: dataJson,
        createdAt: now,
      })
    }

    return {
      id: input.id,
      verb: input.verb,
      from: input.from,
      to: input.to,
      data: input.data ? (input.data as Record<string, unknown>) : null,
      createdAt: new Date(now),
    }
  }

  /**
   * Query relationships by source URL (forward traversal)
   *
   * @param url - The source URL to query from
   * @param options - Optional verb filter
   * @returns Array of relationships originating from the URL
   */
  async queryByFrom(url: string, options?: RelationshipQueryOptions): Promise<GraphRelationship[]> {
    if (this.inMemoryStore) {
      // In-memory mode
      let results = Array.from(this.inMemoryStore.values()).filter((rel) => rel.from === url)
      if (options?.verb) {
        results = results.filter((rel) => rel.verb === options.verb)
      }
      return results.map(this.storedToRelationship)
    }

    // Drizzle database mode
    const condition = options?.verb
      ? and(eq(graphRelationships.from, url), eq(graphRelationships.verb, options.verb))
      : eq(graphRelationships.from, url)

    const results = await this.db!.select().from(graphRelationships).where(condition)

    return results.map(this.rowToRelationship)
  }

  /**
   * Query relationships by target URL (backward traversal)
   *
   * @param url - The target URL to query to
   * @param options - Optional verb filter
   * @returns Array of relationships pointing to the URL
   */
  async queryByTo(url: string, options?: RelationshipQueryOptions): Promise<GraphRelationship[]> {
    if (this.inMemoryStore) {
      // In-memory mode
      let results = Array.from(this.inMemoryStore.values()).filter((rel) => rel.to === url)
      if (options?.verb) {
        results = results.filter((rel) => rel.verb === options.verb)
      }
      return results.map(this.storedToRelationship)
    }

    // Drizzle database mode
    const condition = options?.verb
      ? and(eq(graphRelationships.to, url), eq(graphRelationships.verb, options.verb))
      : eq(graphRelationships.to, url)

    const results = await this.db!.select().from(graphRelationships).where(condition)

    return results.map(this.rowToRelationship)
  }

  /**
   * Query all relationships with a specific verb
   *
   * @param verb - The verb to query by
   * @returns Array of relationships with the given verb
   */
  async queryByVerb(verb: string): Promise<GraphRelationship[]> {
    if (this.inMemoryStore) {
      // In-memory mode
      const results = Array.from(this.inMemoryStore.values()).filter((rel) => rel.verb === verb)
      return results.map(this.storedToRelationship)
    }

    // Drizzle database mode
    const results = await this.db!
      .select()
      .from(graphRelationships)
      .where(eq(graphRelationships.verb, verb))

    return results.map(this.rowToRelationship)
  }

  /**
   * Query relationships from and to specific URLs with optional verb filter
   *
   * @param options - Query options with from, to, and verb filters
   * @returns Array of matching relationships
   */
  async list(options: { from?: string; to?: string; verb?: string }): Promise<GraphRelationship[]> {
    if (this.inMemoryStore) {
      // In-memory mode
      let results = Array.from(this.inMemoryStore.values())
      if (options.from) {
        results = results.filter((rel) => rel.from === options.from)
      }
      if (options.to) {
        results = results.filter((rel) => rel.to === options.to)
      }
      if (options.verb) {
        results = results.filter((rel) => rel.verb === options.verb)
      }
      return results.map(this.storedToRelationship)
    }

    // Drizzle database mode - build condition
    const conditions = []
    if (options.from) {
      conditions.push(eq(graphRelationships.from, options.from))
    }
    if (options.to) {
      conditions.push(eq(graphRelationships.to, options.to))
    }
    if (options.verb) {
      conditions.push(eq(graphRelationships.verb, options.verb))
    }

    const condition = conditions.length > 0 ? and(...conditions) : undefined
    const results = condition
      ? await this.db!.select().from(graphRelationships).where(condition)
      : await this.db!.select().from(graphRelationships)

    return results.map(this.rowToRelationship)
  }

  /**
   * Delete a relationship by ID
   *
   * @param id - The relationship ID to delete
   * @returns true if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    if (this.inMemoryStore) {
      // In-memory mode
      return this.inMemoryStore.delete(id)
    }

    // Drizzle database mode
    const result = await this.db!
      .delete(graphRelationships)
      .where(eq(graphRelationships.id, id))
      .returning()

    return result.length > 0
  }

  /**
   * Convert a stored relationship to a GraphRelationship
   */
  private storedToRelationship = (stored: StoredRelationship): GraphRelationship => {
    let data: Record<string, unknown> | null = null
    if (stored.data) {
      try {
        data = JSON.parse(stored.data) as Record<string, unknown>
      } catch {
        data = null
      }
    }

    return {
      id: stored.id,
      verb: stored.verb,
      from: stored.from,
      to: stored.to,
      data,
      createdAt: new Date(stored.createdAt),
    }
  }

  /**
   * Convert a database row to a GraphRelationship
   */
  private rowToRelationship = (row: typeof graphRelationships.$inferSelect): GraphRelationship => {
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
      createdAt: new Date(row.createdAt),
    }
  }
}
