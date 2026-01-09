import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { eq, and } from 'drizzle-orm'

// ============================================================================
// RELATIONSHIPS - Edges (fully qualified URL-based)
// ============================================================================

export const relationships = sqliteTable(
  'relationships',
  {
    id: text('id').primaryKey(),
    verb: text('verb').notNull(), // 'created', 'manages', 'owns'

    // Fully qualified URLs - can be local, cross-DO, or external
    from: text('from').notNull(), // 'https://startups.studio/headless.ly'
    to: text('to').notNull(), // 'https://startups.studio/nathan' or 'https://github.com/user'

    // Edge properties
    data: text('data', { mode: 'json' }),

    // Timestamps
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    verbIdx: index('rel_verb_idx').on(table.verb),
    fromIdx: index('rel_from_idx').on(table.from),
    toIdx: index('rel_to_idx').on(table.to),
    fromVerbIdx: index('rel_from_verb_idx').on(table.from, table.verb),
    toVerbIdx: index('rel_to_verb_idx').on(table.to, table.verb),
    uniqueEdge: uniqueIndex('rel_unique_idx').on(table.verb, table.from, table.to),
  }),
)

// ============================================================================
// Type Exports
// ============================================================================

/** Select type for relationship records */
export type Relationship = typeof relationships.$inferSelect

/** Insert type for new relationship records */
export type NewRelationship = typeof relationships.$inferInsert

// ============================================================================
// Query Helpers
// ============================================================================

type DrizzleDB = { select: Function; insert: Function; delete: Function }

/**
 * Get all outgoing relationships from a source URL
 * @param db - Drizzle database instance
 * @param from - Source URL
 * @param verb - Optional verb filter
 */
export function getRelationshipsFrom<T extends DrizzleDB>(
  db: T,
  from: string,
  verb?: string,
): Promise<Relationship[]> {
  const query = db.select().from(relationships)
  if (verb) {
    return (query as any).where(and(eq(relationships.from, from), eq(relationships.verb, verb)))
  }
  return (query as any).where(eq(relationships.from, from))
}

/**
 * Get all incoming relationships to a target URL
 * @param db - Drizzle database instance
 * @param to - Target URL
 * @param verb - Optional verb filter
 */
export function getRelationshipsTo<T extends DrizzleDB>(
  db: T,
  to: string,
  verb?: string,
): Promise<Relationship[]> {
  const query = db.select().from(relationships)
  if (verb) {
    return (query as any).where(and(eq(relationships.to, to), eq(relationships.verb, verb)))
  }
  return (query as any).where(eq(relationships.to, to))
}

/**
 * Create a new relationship
 * @param db - Drizzle database instance
 * @param data - Relationship data to insert
 */
export function createRelationship<T extends DrizzleDB>(
  db: T,
  data: NewRelationship,
): Promise<Relationship> {
  return (db.insert(relationships).values(data).returning() as any).then((rows: Relationship[]) => rows[0])
}

/**
 * Delete a relationship by ID
 * @param db - Drizzle database instance
 * @param id - Relationship ID to delete
 */
export function deleteRelationship<T extends DrizzleDB>(
  db: T,
  id: string,
): Promise<void> {
  return (db.delete(relationships).where(eq(relationships.id, id)) as any)
}
