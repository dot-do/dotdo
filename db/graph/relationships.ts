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
// RelationshipsStore Class
// ============================================================================

/**
 * RelationshipsStore manages graph edges with verb-based predicates.
 *
 * Uses Drizzle ORM for all database operations against the relationships table.
 */
export class RelationshipsStore {
  private db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
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

    await this.db.insert(graphRelationships).values({
      id: input.id,
      verb: input.verb,
      from: input.from,
      to: input.to,
      data: dataJson,
      createdAt: now,
    })

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
    const condition = options?.verb
      ? and(eq(graphRelationships.from, url), eq(graphRelationships.verb, options.verb))
      : eq(graphRelationships.from, url)

    const results = await this.db.select().from(graphRelationships).where(condition)

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
    const condition = options?.verb
      ? and(eq(graphRelationships.to, url), eq(graphRelationships.verb, options.verb))
      : eq(graphRelationships.to, url)

    const results = await this.db.select().from(graphRelationships).where(condition)

    return results.map(this.rowToRelationship)
  }

  /**
   * Query all relationships with a specific verb
   *
   * @param verb - The verb to query by
   * @returns Array of relationships with the given verb
   */
  async queryByVerb(verb: string): Promise<GraphRelationship[]> {
    const results = await this.db
      .select()
      .from(graphRelationships)
      .where(eq(graphRelationships.verb, verb))

    return results.map(this.rowToRelationship)
  }

  /**
   * Delete a relationship by ID
   *
   * @param id - The relationship ID to delete
   * @returns true if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(graphRelationships)
      .where(eq(graphRelationships.id, id))
      .returning()

    return result.length > 0
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
