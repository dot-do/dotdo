/**
 * @module core/DB
 *
 * Schema definition wrapper for @dotdo/core that bridges ai-database syntax
 * with Drizzle ORM schema generation. Provides a declarative way to define
 * database schemas using relationship operators.
 *
 * ## Relationship Operators
 *
 * | Operator | Direction | Match Mode | Description |
 * |----------|-----------|------------|-------------|
 * | `->`     | forward   | exact      | Create children (Blog -> Posts) |
 * | `~>`     | forward   | fuzzy      | Find or create (Campaign ~> Audience) |
 * | `<-`     | backward  | exact      | Aggregation (Blog collects Posts) |
 * | `<~`     | backward  | fuzzy      | Ground against reference data (ICP <~ Occupation) |
 *
 * @example Basic usage
 * ```typescript
 * import { DB } from '@dotdo/core'
 *
 * const schema = DB({
 *   Customer: {
 *     name: 'string',
 *     '-> orders': 'Order[]',
 *     '<~ industry': 'Industry',
 *   },
 *   Order: {
 *     amount: 'number',
 *     customer: '<-Customer',
 *   },
 *   Industry: { name: 'string', naicsCode: 'string' },
 * })
 *
 * // Extend DO with schema
 * class MyDO extends DOCore.with(schema) { }
 * ```
 *
 * @packageDocumentation
 */

import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'
import type { z } from 'zod'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Primitive field types supported in schema definitions.
 * Maps to appropriate SQLite/Drizzle column types.
 */
export type PrimitiveType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'markdown'
  | 'json'
  | 'url'

/**
 * Relationship operators for defining entity relationships.
 */
export type RelationshipOperator = '->' | '~>' | '<-' | '<~'

/**
 * A field definition can be:
 * - A primitive type: 'string', 'number', etc.
 * - A relation with operator: '->Author', '<~Category'
 * - An array type: 'string[]', '->Order[]'
 * - An optional type: 'string?'
 */
export type FieldDefinition = string | [string]

/**
 * Schema for a single entity type.
 * Keys are field names, values are field definitions.
 * Keys can include operators: '-> orders', '<~ industry'
 */
export type EntitySchema = Record<string, FieldDefinition>

/**
 * Full database schema definition.
 * Keys are entity names (PascalCase), values are entity schemas.
 */
export type DatabaseSchema = Record<string, EntitySchema | z.ZodObject<z.ZodRawShape>>

/**
 * Parsed field information after processing.
 */
export interface ParsedField {
  name: string
  type: string
  isArray: boolean
  isOptional: boolean
  isRelation: boolean
  relatedType?: string
  backref?: string
  operator?: RelationshipOperator
  direction?: 'forward' | 'backward'
  matchMode?: 'exact' | 'fuzzy'
}

/**
 * Parsed entity with all fields resolved.
 */
export interface ParsedEntity {
  name: string
  fields: Map<string, ParsedField>
}

/**
 * Fully parsed schema with bi-directional relationships resolved.
 */
export interface ParsedSchema {
  entities: Map<string, ParsedEntity>
}

/**
 * Drizzle schema object - collection of table definitions.
 * We use a generic Record type since actual table types are complex.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleSchema = Record<string, any>

/**
 * Result of DB() function - contains both parsed schema and Drizzle tables.
 */
export interface DBSchemaResult {
  /** Parsed schema with entity and field metadata */
  parsed: ParsedSchema
  /** Drizzle table definitions for type-safe queries */
  tables: DrizzleSchema
  /** Raw schema input for reference */
  raw: DatabaseSchema
}

// =============================================================================
// PRIMITIVE TYPE MAPPING
// =============================================================================

/**
 * Valid primitive types that map to SQLite columns.
 */
const PRIMITIVE_TYPES: PrimitiveType[] = [
  'string',
  'number',
  'boolean',
  'date',
  'datetime',
  'markdown',
  'json',
  'url',
]

/**
 * Check if a type string is a primitive type.
 */
function isPrimitiveType(type: string): type is PrimitiveType {
  return PRIMITIVE_TYPES.includes(type as PrimitiveType)
}

/**
 * Convert a primitive type to snake_case for column naming.
 */
function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
}

/**
 * Pluralize an entity name for table naming.
 */
function pluralize(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) {
    return name.slice(0, -1) + 'ies'
  }
  if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('ch') || lower.endsWith('sh')) {
    return name + 'es'
  }
  return name + 's'
}

// =============================================================================
// OPERATOR PARSING
// =============================================================================

/**
 * Relationship operators in order of specificity (longer first).
 */
const OPERATORS: readonly RelationshipOperator[] = ['~>', '<~', '->', '<-']

/**
 * Parse a field key that may contain an operator.
 * Field keys can be: 'name', '-> orders', '<~ industry'
 *
 * @param key - The field key from schema definition
 * @returns Parsed operator info and clean field name
 */
function parseFieldKey(key: string): {
  name: string
  operator?: RelationshipOperator
  direction?: 'forward' | 'backward'
  matchMode?: 'exact' | 'fuzzy'
} {
  const trimmed = key.trim()

  for (const op of OPERATORS) {
    if (trimmed.startsWith(op)) {
      const name = trimmed.slice(op.length).trim()
      return {
        name,
        operator: op,
        direction: op.startsWith('<') ? 'backward' : 'forward',
        matchMode: op.includes('~') ? 'fuzzy' : 'exact',
      }
    }
  }

  return { name: trimmed }
}

/**
 * Parse a field value that may contain an operator.
 * Field values can be: 'string', '->Author', '<~Category[]'
 *
 * @param value - The field value from schema definition
 * @returns Parsed operator info and clean type
 */
function parseFieldValue(value: string): {
  type: string
  isArray: boolean
  isOptional: boolean
  operator?: RelationshipOperator
  direction?: 'forward' | 'backward'
  matchMode?: 'exact' | 'fuzzy'
  relatedType?: string
} {
  let type = value.trim()
  let isArray = false
  let isOptional = false
  let operator: RelationshipOperator | undefined
  let direction: 'forward' | 'backward' | undefined
  let matchMode: 'exact' | 'fuzzy' | undefined
  let relatedType: string | undefined

  // Check for operator prefix
  for (const op of OPERATORS) {
    if (type.startsWith(op)) {
      operator = op
      direction = op.startsWith('<') ? 'backward' : 'forward'
      matchMode = op.includes('~') ? 'fuzzy' : 'exact'
      type = type.slice(op.length).trim()
      break
    }
  }

  // Check for optional modifier
  if (type.endsWith('?')) {
    isOptional = true
    type = type.slice(0, -1)
  }

  // Check for array modifier
  if (type.endsWith('[]')) {
    isArray = true
    type = type.slice(0, -2)
  }

  // Handle backref syntax (Type.field)
  if (type.includes('.')) {
    const [entityName, backref] = type.split('.')
    type = entityName!
    relatedType = entityName
  }

  // If it's PascalCase and not a primitive, it's a relation
  if (
    type[0] === type[0]?.toUpperCase() &&
    !isPrimitiveType(type) &&
    !type.includes(' ')
  ) {
    relatedType = type
  }

  return {
    type,
    isArray,
    isOptional,
    operator,
    direction,
    matchMode,
    relatedType,
  }
}

/**
 * Parse a single field definition.
 *
 * @param key - The field key (may contain operator)
 * @param definition - The field definition (string or array)
 * @returns Parsed field information
 */
function parseField(key: string, definition: FieldDefinition): ParsedField {
  const keyInfo = parseFieldKey(key)

  // Handle array literal syntax: ['Type']
  if (Array.isArray(definition)) {
    const inner = parseField(keyInfo.name, definition[0])
    return { ...inner, isArray: true }
  }

  const valueInfo = parseFieldValue(definition)

  // Merge key and value info (key operator takes precedence)
  const operator = keyInfo.operator || valueInfo.operator
  const direction = keyInfo.direction || valueInfo.direction
  const matchMode = keyInfo.matchMode || valueInfo.matchMode

  return {
    name: keyInfo.name,
    type: valueInfo.type,
    isArray: valueInfo.isArray,
    isOptional: valueInfo.isOptional,
    isRelation: !!valueInfo.relatedType || !!operator,
    relatedType: valueInfo.relatedType,
    operator,
    direction,
    matchMode,
  }
}

// =============================================================================
// ZOD SCHEMA DETECTION
// =============================================================================

/**
 * Check if a value is a Zod schema object.
 */
function isZodSchema(value: unknown): value is z.ZodObject<z.ZodRawShape> {
  return (
    value !== null &&
    typeof value === 'object' &&
    '_def' in value &&
    typeof (value as { _def?: unknown })._def === 'object'
  )
}

/**
 * Convert a Zod schema to an EntitySchema.
 *
 * @param zodSchema - The Zod schema object
 * @returns Equivalent EntitySchema
 */
function zodToEntitySchema(zodSchema: z.ZodObject<z.ZodRawShape>): EntitySchema {
  const shape = zodSchema.shape
  const result: EntitySchema = {}

  for (const [key, zodType] of Object.entries(shape)) {
    // Extract the base Zod type and modifiers
    let type = 'string' // Default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = zodType

    // Unwrap optional
    if (current._def?.typeName === 'ZodOptional') {
      current = current._def.innerType
    }

    // Unwrap nullable
    if (current._def?.typeName === 'ZodNullable') {
      current = current._def.innerType
    }

    // Determine type from Zod type name
    const typeName = current._def?.typeName
    switch (typeName) {
      case 'ZodString':
        type = 'string'
        break
      case 'ZodNumber':
        type = 'number'
        break
      case 'ZodBoolean':
        type = 'boolean'
        break
      case 'ZodDate':
        type = 'datetime'
        break
      case 'ZodObject':
      case 'ZodRecord':
        type = 'json'
        break
      case 'ZodArray':
        type = 'json' // Arrays stored as JSON
        break
      default:
        type = 'string'
    }

    result[key] = type
  }

  return result
}

// =============================================================================
// SCHEMA PARSING
// =============================================================================

/**
 * Parse a full database schema definition.
 *
 * @param schema - The raw database schema
 * @returns Parsed schema with resolved relationships
 */
export function parseSchema(schema: DatabaseSchema): ParsedSchema {
  const entities = new Map<string, ParsedEntity>()

  // First pass: parse all entities
  for (const entityName of Object.keys(schema)) {
    const entitySchema = schema[entityName]!
    // Convert Zod schemas to EntitySchema
    const normalizedSchema: EntitySchema = isZodSchema(entitySchema)
      ? zodToEntitySchema(entitySchema)
      : entitySchema

    const fields = new Map<string, ParsedField>()

    for (const [fieldKey, fieldDef] of Object.entries(normalizedSchema)) {
      // Skip metadata fields (prefixed with $)
      if (fieldKey.startsWith('$')) continue

      const parsed = parseField(fieldKey, fieldDef)
      fields.set(parsed.name, parsed)
    }

    entities.set(entityName, { name: entityName, fields })
  }

  // Second pass: create bi-directional relationships
  entities.forEach((entity, entityName) => {
    entity.fields.forEach((field) => {
      if (field.isRelation && field.relatedType && field.backref) {
        const relatedEntity = entities.get(field.relatedType)
        if (relatedEntity && !relatedEntity.fields.has(field.backref)) {
          // Auto-create the inverse relation
          relatedEntity.fields.set(field.backref, {
            name: field.backref,
            type: entityName,
            isArray: true,
            isOptional: false,
            isRelation: true,
            relatedType: entityName,
            // Inverse direction
            operator: field.operator === '->' ? '<-' : field.operator === '~>' ? '<~' : undefined,
            direction: field.direction === 'forward' ? 'backward' : 'forward',
            matchMode: field.matchMode,
          })
        }
      }
    })
  })

  return { entities }
}

// =============================================================================
// DRIZZLE SCHEMA GENERATION
// =============================================================================

/**
 * Generate a Drizzle column definition from a parsed field.
 *
 * @param field - The parsed field
 * @param columnName - The column name in snake_case
 * @returns Drizzle column builder
 */
function fieldToDrizzleColumn(field: ParsedField, columnName: string) {
  const { type, isOptional, isRelation, isArray } = field

  // Relations are stored as foreign keys (text) or arrays (json)
  if (isRelation) {
    if (isArray) {
      // Array relations stored as JSON array of IDs
      return isOptional
        ? text(columnName, { mode: 'json' })
        : text(columnName, { mode: 'json' }).notNull()
    }
    // Single relation stored as text ID
    return isOptional ? text(columnName) : text(columnName).notNull()
  }

  // Map primitive types to Drizzle columns
  switch (type) {
    case 'string':
    case 'url':
    case 'markdown':
      return isOptional ? text(columnName) : text(columnName).notNull()

    case 'number':
      // Use real for numbers to support decimals
      return isOptional ? real(columnName) : real(columnName).notNull()

    case 'boolean':
      // SQLite stores booleans as integers
      return isOptional
        ? integer(columnName, { mode: 'boolean' })
        : integer(columnName, { mode: 'boolean' }).notNull()

    case 'date':
    case 'datetime':
      // Store dates as ISO strings
      return isOptional ? text(columnName) : text(columnName).notNull()

    case 'json':
      return isOptional
        ? text(columnName, { mode: 'json' })
        : text(columnName, { mode: 'json' }).notNull()

    default:
      // Unknown types default to text
      return isOptional ? text(columnName) : text(columnName).notNull()
  }
}

/**
 * Generate Drizzle table definitions from a parsed schema.
 *
 * @param parsed - The parsed schema
 * @returns Object containing Drizzle table definitions
 */
function generateDrizzleTables(parsed: ParsedSchema): DrizzleSchema {
  const tables: DrizzleSchema = {}

  parsed.entities.forEach((entity, entityName) => {
    const tableName = toSnakeCase(pluralize(entityName))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const columns: Record<string, any> = {
      // Standard ID and metadata columns
      $id: text('$id').primaryKey(),
      $type: text('$type').notNull().default(entityName),
      $createdAt: text('$created_at').notNull(),
      $updatedAt: text('$updated_at').notNull(),
    }

    // Add entity-specific columns
    entity.fields.forEach((field, fieldName) => {
      const columnName = toSnakeCase(fieldName)
      columns[fieldName] = fieldToDrizzleColumn(field, columnName)
    })

    // Create the table with indexes
    tables[entityName] = sqliteTable(
      tableName,
      columns,
      (table) => {
        const indexes = [
          index(`${tableName}_type_idx`).on(table.$type),
        ]

        // Add indexes for relation fields
        entity.fields.forEach((field, fieldName) => {
          if (field.isRelation && !field.isArray) {
            const columnName = toSnakeCase(fieldName)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((table as any)[fieldName]) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              indexes.push(index(`${tableName}_${columnName}_idx`).on((table as any)[fieldName]))
            }
          }
        })

        return indexes
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any
  })

  return tables
}

// =============================================================================
// DB FUNCTION
// =============================================================================

/**
 * Create a database schema from a declarative definition.
 *
 * The DB function accepts a schema object with entity definitions using
 * ai-database syntax (relationship operators) and generates:
 * 1. Parsed schema with field metadata and resolved relationships
 * 2. Drizzle table definitions for type-safe queries
 *
 * ## Relationship Operators
 *
 * Use operators in field keys or values:
 * - `'-> orders': 'Order[]'` - Forward exact: create children
 * - `'~> audience': 'Audience'` - Forward fuzzy: find or create
 * - `'<- author': 'Author'` - Backward exact: aggregation
 * - `'<~ industry': 'Industry'` - Backward fuzzy: ground against reference
 *
 * ## Field Types
 *
 * - `string` - Text column
 * - `number` - Real/float column
 * - `boolean` - Integer (0/1) column
 * - `date`, `datetime` - Text (ISO format)
 * - `markdown` - Text column
 * - `json` - Text (JSON encoded)
 * - `url` - Text column
 *
 * @param schema - Database schema definition
 * @returns Schema result with parsed metadata and Drizzle tables
 *
 * @example Basic usage
 * ```typescript
 * const schema = DB({
 *   Customer: {
 *     name: 'string',
 *     email: 'string',
 *     '-> orders': 'Order[]',
 *   },
 *   Order: {
 *     amount: 'number',
 *     status: 'string',
 *   },
 * })
 *
 * class MyDO extends DOCore.with(schema.tables) {
 *   async getCustomer(id: string) {
 *     return this.db.select().from(schema.tables.Customer).where(eq($id, id))
 *   }
 * }
 * ```
 *
 * @example With Zod schemas
 * ```typescript
 * import { z } from 'zod'
 *
 * const schema = DB({
 *   Customer: z.object({
 *     name: z.string(),
 *     email: z.string().email(),
 *     age: z.number().optional(),
 *   }),
 * })
 * ```
 */
export function DB(schema: DatabaseSchema): DBSchemaResult {
  const parsed = parseSchema(schema)
  const tables = generateDrizzleTables(parsed)

  return {
    parsed,
    tables,
    raw: schema,
  }
}

/**
 * Pass through raw Drizzle schemas without transformation.
 *
 * Use this escape hatch when you need direct Drizzle table definitions
 * without the ai-database syntax layer.
 *
 * @param drizzleSchema - Raw Drizzle schema object
 * @returns The same schema wrapped in DBSchemaResult format
 *
 * @example
 * ```typescript
 * import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
 *
 * const rawSchema = {
 *   customers: sqliteTable('customers', {
 *     id: text('id').primaryKey(),
 *     name: text('name').notNull(),
 *   }),
 * }
 *
 * const schema = DB.drizzle(rawSchema)
 * class MyDO extends DOCore.with(schema.tables) { }
 * ```
 */
DB.drizzle = function(drizzleSchema: DrizzleSchema): DBSchemaResult {
  return {
    parsed: { entities: new Map() },
    tables: drizzleSchema,
    raw: {},
  }
}

// =============================================================================
// EXTEND SCHEMA
// =============================================================================

/**
 * Merge multiple schemas into one.
 *
 * Combines schemas from different sources while handling conflicts.
 * Later schemas override earlier ones for conflicting table names.
 *
 * @param schemas - Array of DBSchemaResult objects to merge
 * @returns Merged schema result
 *
 * @example
 * ```typescript
 * import { DB, extendSchema } from '@dotdo/core'
 *
 * const baseSchema = DB({
 *   User: { name: 'string', email: 'string' },
 * })
 *
 * const billingSchema = DB({
 *   Invoice: { amount: 'number', '-> user': 'User' },
 * })
 *
 * const fullSchema = extendSchema(baseSchema, billingSchema)
 *
 * class MyDO extends DOCore.with(fullSchema.tables) { }
 * ```
 */
export function extendSchema(...schemas: DBSchemaResult[]): DBSchemaResult {
  const mergedEntities = new Map<string, ParsedEntity>()
  const mergedTables: DrizzleSchema = {}
  const mergedRaw: DatabaseSchema = {}

  for (const schema of schemas) {
    // Merge parsed entities
    schema.parsed.entities.forEach((entity, name) => {
      if (mergedEntities.has(name)) {
        // Merge fields from both entities
        const existing = mergedEntities.get(name)!
        entity.fields.forEach((field, fieldName) => {
          existing.fields.set(fieldName, field)
        })
      } else {
        // Create a new Map with copied entries
        const fieldsCopy = new Map<string, ParsedField>()
        entity.fields.forEach((field, fieldName) => {
          fieldsCopy.set(fieldName, field)
        })
        mergedEntities.set(name, {
          name: entity.name,
          fields: fieldsCopy,
        })
      }
    })

    // Merge Drizzle tables (later overrides earlier)
    Object.assign(mergedTables, schema.tables)

    // Merge raw schemas
    Object.assign(mergedRaw, schema.raw)
  }

  return {
    parsed: { entities: mergedEntities },
    tables: mergedTables,
    raw: mergedRaw,
  }
}

// =============================================================================
// TYPE RE-EXPORTS
// =============================================================================

// Re-export Drizzle types for convenience
export type { SQLiteTableWithColumns, AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
