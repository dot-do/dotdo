import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// ============================================================================
// NOUNS - Optional Type Registry (for validation/introspection, not required FK)
// ============================================================================

export const nouns = sqliteTable('nouns', {
  noun: text('noun').primaryKey(),                 // 'Customer', 'Agent'
  plural: text('plural'),                          // 'Customers', 'Agents'
  description: text('description'),
  schema: text('schema', { mode: 'json' }),        // Field definitions
  doClass: text('do_class'),                       // CF binding if DO subclass
})
