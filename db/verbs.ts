import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// ============================================================================
// VERBS - Optional Predicate Registry (for validation/introspection)
// ============================================================================

export const verbs = sqliteTable('verbs', {
  verb: text('verb').primaryKey(),                 // 'create' (base action form)
  activity: text('activity'),                      // 'creating'
  event: text('event'),                            // 'created'
  inverse: text('inverse'),                        // 'delete'
  description: text('description'),
})

// Convention: given verb 'create' / event 'created'
// - createdBy = actor
// - createdAt = timestamp
// - createdIn = request/context
