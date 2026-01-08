import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// ============================================================================
// VERBS - Predicate Registry
// ============================================================================
//
// Verbs define the predicates used in relationships and actions.
// They have linguistic forms for natural language generation.
//
// Example: 'creates' verb
//   verb: 'creates'       - predicate form (Subject creates Object)
//   action: 'create'      - imperative form ($.do('create', ...))
//   activity: 'creating'  - present participle
//   event: 'created'      - past participle
//   reverse: 'createdBy'  - backward operator (<-, <~)
//   inverse: 'deletes'    - opposite predicate
//
// Graph reads naturally: "Startup creates Product", "User manages Team"
//
// Convention: given event 'created'
//   - createdBy = actor
//   - createdAt = timestamp
//   - createdIn = request/context
// ============================================================================

export const verbs = sqliteTable('verbs', {
  // Predicate form - reads naturally in graph relationships
  verb: text('verb').primaryKey(), // 'creates' (Subject creates Object)

  // Linguistic forms
  action: text('action'), // 'create' (imperative / base form)
  activity: text('activity'), // 'creating' (present participle / gerund)
  event: text('event'), // 'created' (past participle)
  reverse: text('reverse'), // 'createdBy' (for <-, <~ backward operators)
  inverse: text('inverse'), // 'deletes' (opposite predicate)

  // Metadata
  description: text('description'),
})
