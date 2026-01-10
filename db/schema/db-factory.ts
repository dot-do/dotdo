/**
 * DB() Factory for Cascade Generation System
 *
 * Creates typed schema objects from schema definitions.
 */

import { parseSchema, isPascalCase } from './parse-schema'
import type { SchemaDefinition, DBSchema, LegacyParsedType } from './types'

/**
 * Validate schema input
 */
function validateSchema(def: unknown): asserts def is SchemaDefinition {
  if (def === null || def === undefined) {
    throw new Error('Schema definition is invalid: cannot be null or undefined')
  }

  if (typeof def !== 'object' || Array.isArray(def)) {
    throw new Error('Schema definition is invalid: must be an object')
  }

  // Check for at least one PascalCase type definition
  const hasTypes = Object.keys(def as object).some(
    (key) => isPascalCase(key) && typeof (def as Record<string, unknown>)[key] === 'object'
  )

  if (!hasTypes) {
    throw new Error('Schema definition is invalid: must contain at least one type definition')
  }
}

/**
 * DB() Factory Function
 *
 * Creates a typed schema object from a schema definition.
 *
 * @example
 * ```typescript
 * const schema = DB({
 *   $id: 'https://startup.db.sb',
 *   $context: 'startup',
 *   User: {
 *     name: 'string',
 *     email: 'string',
 *   },
 * })
 *
 * const userType = schema.getType('User')
 * ```
 */
export function DB<T extends SchemaDefinition>(def: T): DBSchema<T> {
  validateSchema(def)

  const parsed = parseSchema(def)

  // Build types Map
  const typesMap = new Map<string, LegacyParsedType>()
  for (const type of parsed.types) {
    typesMap.set(type.name, type)
  }

  // Create base schema object
  const schema: DBSchema<T> = {
    $id: parsed.metadata.$id,
    $context: parsed.metadata.$context,
    $version: parsed.metadata.$version,
    $fn: parsed.metadata.$fn,
    types: typesMap,
    getType: (name: string) => typesMap.get(name),
  }

  // Add direct access to types via their names (e.g., schema.User, schema.Startup)
  for (const [name, type] of typesMap) {
    ;(schema as Record<string, unknown>)[name] = type
  }

  return schema
}
