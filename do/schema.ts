/**
 * Schema definitions for entity types
 *
 * Provides types and utilities for defining entity schemas in the DO context.
 * This module bridges the entity proxy (do-lekf.2) and ai-database style
 * schema definitions (do-lekf.8).
 *
 * @module do/schema
 */

/**
 * Parsed entity schema with resolved field types
 * Used internally by the entity proxy system
 */
export interface EntitySchema {
  /** Entity type name */
  name: string
  /** Whether this entity has been defined via schema */
  defined?: boolean
  /** Parsed field definitions */
  fields?: Record<string, ParsedField>
  /** Whether to validate on create/update */
  strict?: boolean
  /** Relation definitions */
  relations?: Record<string, RelationDefinition>
}

/**
 * Parsed field definition with resolved types
 */
export interface ParsedField {
  type: 'string' | 'number' | 'boolean' | 'decimal' | 'datetime' | 'json' | 'relation'
  required: boolean
  unique?: boolean
  indexed?: boolean
  primary?: boolean
  default?: unknown
  precision?: number
  scale?: number
  description?: string
}

/**
 * Relation definition
 */
export interface RelationDefinition {
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'
  target: string
  through?: string
  field?: string
  required?: boolean
}

/**
 * Raw database schema as passed to $.DB()
 * Uses ai-database style shorthand notation
 */
export type RawDatabaseSchema = Record<string, RawEntitySchema>

/**
 * Raw entity schema with shorthand field definitions
 *
 * Field shorthand notation:
 * - 'string' - optional string field
 * - 'string!' - required string field
 * - 'string!#' - required string, unique indexed
 * - 'decimal(10,2)!' - required decimal with precision
 * - '-> Entity' - one-to-one relation
 * - '-> Entity?' - optional relation
 * - '<- Entity.field[]' - inverse one-to-many
 */
export type RawEntitySchema = Record<string, string>

/**
 * Result of parsing a raw database schema
 */
export interface ParsedSchemaResult {
  /** Map of entity name to parsed schema */
  entities: Map<string, EntitySchema>
  /** Validation errors encountered during parsing */
  errors?: string[]
}

/**
 * Parse a raw database schema into parsed entity schemas
 *
 * @param rawSchema - Raw schema with shorthand notation
 * @returns ParsedSchemaResult with entities map
 */
export function parseSchema(rawSchema: RawDatabaseSchema): ParsedSchemaResult {
  const schemas = new Map<string, EntitySchema>()

  for (const [entityName, fieldDefs] of Object.entries(rawSchema)) {
    const fields: Record<string, ParsedField> = {}
    const relations: Record<string, RelationDefinition> = {}

    for (const [fieldName, fieldDef] of Object.entries(fieldDefs)) {
      const parsed = parseFieldDefinition(fieldDef, entityName)
      if (parsed.isRelation) {
        relations[fieldName] = parsed.relation!
      } else {
        fields[fieldName] = parsed.field!
      }
    }

    schemas.set(entityName, {
      name: entityName,
      defined: true,
      fields,
      relations: Object.keys(relations).length > 0 ? relations : undefined,
    })
  }

  return { entities: schemas }
}

/**
 * Parse a single field definition string
 */
function parseFieldDefinition(
  def: string,
  _entityName: string
): { isRelation: boolean; field?: ParsedField; relation?: RelationDefinition } {
  // Check for relation definitions
  if (def.startsWith('->') || def.startsWith('<-')) {
    return {
      isRelation: true,
      relation: parseRelation(def),
    }
  }

  // Parse regular field
  const required = def.includes('!')
  const unique = def.includes('#')
  const indexed = def.includes('^') || unique

  // Extract base type
  let baseType = def.replace(/[!#^?]/g, '').trim()

  // Check for decimal precision
  let precision: number | undefined
  let scale: number | undefined
  const decimalMatch = baseType.match(/^decimal\((\d+),(\d+)\)$/)
  if (decimalMatch) {
    baseType = 'decimal'
    precision = parseInt(decimalMatch[1]!, 10)
    scale = parseInt(decimalMatch[2]!, 10)
  }

  // Map to known types
  const typeMap: Record<string, ParsedField['type']> = {
    string: 'string',
    number: 'number',
    int: 'number',
    integer: 'number',
    float: 'number',
    decimal: 'decimal',
    boolean: 'boolean',
    bool: 'boolean',
    datetime: 'datetime',
    date: 'datetime',
    json: 'json',
    object: 'json',
  }

  // Check if it's a description (contains spaces or starts with capital letter after known types)
  const isDescription = !typeMap[baseType.toLowerCase()] && /^[A-Z]/.test(baseType)

  const parsedType = typeMap[baseType.toLowerCase()] ?? 'string'

  return {
    isRelation: false,
    field: {
      type: parsedType,
      required,
      unique: unique || undefined,
      indexed: indexed || undefined,
      precision,
      scale,
      description: isDescription ? def : undefined,
    },
  }
}

/**
 * Parse a relation definition
 */
function parseRelation(def: string): RelationDefinition {
  const isInverse = def.startsWith('<-')
  const isOptional = def.includes('?')
  const isArray = def.endsWith('[]')

  // Extract target entity and field
  let targetSpec = def.replace(/^(<-|->)\s*/, '').replace(/[\?\[\]]/g, '').trim()

  let target: string
  let field: string | undefined

  if (targetSpec.includes('.')) {
    const parts = targetSpec.split('.')
    target = parts[0]!
    field = parts[1]
  } else {
    target = targetSpec
  }

  if (isInverse && isArray) {
    return {
      type: 'one-to-many',
      target,
      field,
      required: !isOptional,
    }
  }

  if (isInverse) {
    return {
      type: 'many-to-one',
      target,
      field,
      required: !isOptional,
    }
  }

  return {
    type: isArray ? 'one-to-many' : 'one-to-one',
    target,
    required: !isOptional,
  }
}
