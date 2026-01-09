import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { eq, or } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

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

// ============================================================================
// Type Exports
// ============================================================================

/** Select type for verbs table - represents a row returned from queries */
export type Verb = typeof verbs.$inferSelect

/** Insert type for verbs table - represents data for inserting new rows */
export type NewVerb = typeof verbs.$inferInsert

// ============================================================================
// Query Helper Functions
// ============================================================================

/**
 * Get a verb record by its action (imperative) form
 * Example: getVerbByAction(db, 'create') returns the 'creates' verb
 */
export async function getVerbByAction(
  db: BetterSQLite3Database,
  action: string
): Promise<Verb | undefined> {
  const results = await db.select().from(verbs).where(eq(verbs.action, action))
  return results[0]
}

/**
 * Get a verb record by its event (past participle) form
 * Example: getVerbByEvent(db, 'created') returns the 'creates' verb
 */
export async function getVerbByEvent(
  db: BetterSQLite3Database,
  event: string
): Promise<Verb | undefined> {
  const results = await db.select().from(verbs).where(eq(verbs.event, event))
  return results[0]
}

/**
 * Get the inverse verb record for a given verb
 * Example: getInverseVerb(db, 'creates') returns the 'deletes' verb
 */
export async function getInverseVerb(
  db: BetterSQLite3Database,
  verbName: string
): Promise<Verb | undefined> {
  // First get the verb to find its inverse
  const verbResults = await db.select().from(verbs).where(eq(verbs.verb, verbName))
  const verbRecord = verbResults[0]

  if (!verbRecord || !verbRecord.inverse) {
    return undefined
  }

  // Then get the inverse verb record
  const inverseResults = await db.select().from(verbs).where(eq(verbs.verb, verbRecord.inverse))
  return inverseResults[0]
}

/**
 * Resolve any linguistic form to the canonical verb (predicate form)
 * Searches across: verb, action, activity, event, reverse
 * Example: resolveVerbForm(db, 'creating') returns 'creates'
 */
export async function resolveVerbForm(
  db: BetterSQLite3Database,
  form: string
): Promise<string | undefined> {
  const results = await db
    .select()
    .from(verbs)
    .where(
      or(
        eq(verbs.verb, form),
        eq(verbs.action, form),
        eq(verbs.activity, form),
        eq(verbs.event, form),
        eq(verbs.reverse, form)
      )
    )

  return results[0]?.verb
}

/**
 * Get all linguistic forms for a verb
 * Returns an object with all forms: verb, action, activity, event, reverse, inverse
 */
export async function getAllLinguisticForms(
  db: BetterSQLite3Database,
  verbName: string
): Promise<
  | {
      verb: string
      action: string | null
      activity: string | null
      event: string | null
      reverse: string | null
      inverse: string | null
    }
  | undefined
> {
  const results = await db.select().from(verbs).where(eq(verbs.verb, verbName))
  const verbRecord = results[0]

  if (!verbRecord) {
    return undefined
  }

  return {
    verb: verbRecord.verb,
    action: verbRecord.action,
    activity: verbRecord.activity,
    event: verbRecord.event,
    reverse: verbRecord.reverse,
    inverse: verbRecord.inverse,
  }
}
