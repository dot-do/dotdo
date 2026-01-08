import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
