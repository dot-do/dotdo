import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// THINGS - Entities (fully qualified URL identity)
// ============================================================================

export const things = sqliteTable('things', {
  // Identity (fully qualified URLs for unambiguous identity)
  $id: text('$id').primaryKey(),                   // URL: 'https://startups.studio/headless.ly'
  $type: text('$type').notNull(),                  // URL: 'https://startups.studio/Startup' (Noun URL)

  // Parsed from $id (denormalized for queries)
  ns: text('ns').notNull(),                        // Namespace/DO: 'https://startups.studio'
  path: text('path').notNull(),                    // Path after ns: 'headless.ly'

  // Core fields
  name: text('name'),
  data: text('data', { mode: 'json' }),
  meta: text('meta', { mode: 'json' }),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
}, (table) => ({
  typeIdx: index('things_type_idx').on(table.$type),
  nsIdx: index('things_ns_idx').on(table.ns),
  nsTypeIdx: index('things_ns_type_idx').on(table.ns, table.$type),
  typePathIdx: index('things_type_path_idx').on(table.$type, table.path),
}))
