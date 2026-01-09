import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'

// ============================================================================
// NOUNS - Optional Type Registry (for validation/introspection, not required FK)
// ============================================================================

export const nouns = sqliteTable('nouns', {
  noun: text('noun').primaryKey(), // 'Customer', 'Agent'
  plural: text('plural'), // 'Customers', 'Agents'
  description: text('description'),
  schema: text('schema', { mode: 'json' }), // Field definitions
  doClass: text('do_class'), // CF binding if DO subclass
})

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Type for selecting a noun from the database
 */
export type Noun = typeof nouns.$inferSelect

/**
 * Type for inserting a new noun into the database
 */
export type NewNoun = typeof nouns.$inferInsert

/**
 * Runtime type marker for Noun type.
 * Since TypeScript types are erased at runtime, this provides
 * a way to check if Noun type is exported at runtime.
 * This is the table definition itself, useful for type-checking.
 */
export const Noun = nouns

/**
 * Runtime type marker for NewNoun type.
 * Since TypeScript types are erased at runtime, this provides
 * a way to check if NewNoun type is exported at runtime.
 * This is the table definition itself, useful for insert operations.
 */
export const NewNoun = nouns

// ============================================================================
// QUERY HELPER TYPES
// ============================================================================

/**
 * Database interface required for query helpers.
 * This allows the helpers to work with any Drizzle database instance.
 */
export interface NounsDb {
  select(): {
    from(table: typeof nouns): {
      where(condition: ReturnType<typeof eq> | ReturnType<typeof isNotNull>): Promise<Noun[]>
    } & Promise<Noun[]>
  }
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get a single noun by its primary key (noun name).
 *
 * @param db - Drizzle database instance
 * @param nounName - The noun name to look up
 * @returns The noun or undefined if not found
 *
 * @example
 * ```ts
 * const customer = await getNoun(db, 'Customer')
 * if (customer) {
 *   console.log(`${customer.noun} -> ${customer.plural}`)
 * }
 * ```
 */
export async function getNoun(
  db: NounsDb,
  nounName: string
): Promise<Noun | undefined> {
  const results = await db
    .select()
    .from(nouns)
    .where(eq(nouns.noun, nounName))

  return results[0]
}

/**
 * Get all nouns from the registry.
 *
 * @param db - Drizzle database instance
 * @returns Array of all nouns
 *
 * @example
 * ```ts
 * const allNouns = await getAllNouns(db)
 * console.log(`Registry has ${allNouns.length} nouns`)
 * ```
 */
export async function getAllNouns(db: NounsDb): Promise<Noun[]> {
  return db.select().from(nouns)
}

/**
 * Get all nouns that have a Durable Object binding (doClass is not null).
 *
 * @param db - Drizzle database instance
 * @returns Array of nouns with DO bindings
 *
 * @example
 * ```ts
 * const doNouns = await getNounsWithDO(db)
 * doNouns.forEach(n => console.log(`${n.noun} -> ${n.doClass}`))
 * ```
 */
export async function getNounsWithDO(db: NounsDb): Promise<Noun[]> {
  return db
    .select()
    .from(nouns)
    .where(isNotNull(nouns.doClass))
}

/**
 * Get all nouns that have a schema defined (schema is not null).
 *
 * @param db - Drizzle database instance
 * @returns Array of nouns with schemas
 *
 * @example
 * ```ts
 * const schemaNouns = await getNounsWithSchema(db)
 * schemaNouns.forEach(n => console.log(`${n.noun} has schema`))
 * ```
 */
export async function getNounsWithSchema(db: NounsDb): Promise<Noun[]> {
  return db
    .select()
    .from(nouns)
    .where(isNotNull(nouns.schema))
}

/**
 * Check if a noun exists in the registry.
 *
 * @param db - Drizzle database instance
 * @param nounName - The noun name to check
 * @returns Boolean indicating if the noun exists
 *
 * @example
 * ```ts
 * const exists = await nounExists(db, 'Customer')
 * if (!exists) {
 *   // Register the noun
 * }
 * ```
 */
export async function nounExists(
  db: NounsDb,
  nounName: string
): Promise<boolean> {
  const noun = await getNoun(db, nounName)
  return noun !== undefined
}

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

/**
 * Schema for noun field definitions
 */
export const NounFieldSchema = z.object({
  type: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
})

/**
 * Schema for validating noun schema structure.
 * This validates the JSON stored in the schema column.
 */
export const NounSchemaValidator = z.object({
  type: z.string(),
  fields: z.record(z.string(), NounFieldSchema).optional(),
  validators: z.array(z.string()).optional(),
  computed: z.array(z.string()).optional(),
}).passthrough()

export type NounSchema = z.infer<typeof NounSchemaValidator>

/**
 * Validate a noun schema object.
 * Returns the validated schema or throws a ZodError.
 *
 * @param schema - The schema object to validate
 * @returns Validated schema object
 *
 * @example
 * ```ts
 * const schema = validateNounSchema({
 *   type: 'entity',
 *   fields: { name: { type: 'string', required: true } }
 * })
 * ```
 */
export function validateNounSchema(schema: unknown): NounSchema {
  return NounSchemaValidator.parse(schema)
}

/**
 * Check if a noun name follows the PascalCase naming convention.
 *
 * @param noun - The noun name to validate
 * @returns Boolean indicating if the name is valid
 *
 * @example
 * ```ts
 * isValidNounName('Customer')    // true
 * isValidNounName('customer')    // false (lowercase)
 * isValidNounName('my-noun')     // false (contains dash)
 * isValidNounName('MyNoun123')   // true
 * ```
 */
export function isValidNounName(noun: string): boolean {
  // Must start with uppercase letter, can contain letters and numbers
  // PascalCase pattern: starts with uppercase, followed by alphanumeric
  const pascalCasePattern = /^[A-Z][a-zA-Z0-9]*$/
  return pascalCasePattern.test(noun)
}
