/**
 * IceType Schema DSL for @dotdo/db
 *
 * Adapted from db4's IceType schema language - a TypeScript-embedded DSL
 * for defining schemas with AI generation directives, relations, and indexes.
 *
 * Key Features:
 * - Concise string-based field definitions: 'string!', 'int?', 'uuid#'
 * - Relation operators: ->, ~>, <-, <~ for graph traversal
 * - AI generation directives: ~> for auto-generation from source fields
 * - Vector embeddings: vector[1536] ~> textField
 * - Schema directives: $partitionBy, $fts, $vector, $index
 *
 * @example
 * ```typescript
 * const schema = IceType({
 *   Customer: {
 *     $type: 'Customer',
 *     name: 'string!',           // Required string
 *     email: 'string! #unique',  // Required, unique indexed
 *     age: 'int?',               // Optional integer
 *     orders: '-> Order[]',      // Forward relation to Order array
 *     summary: 'text ~> name,email', // AI-generated from name and email
 *     $fts: ['name', 'email'],   // Full-text search on fields
 *   },
 *   Order: {
 *     $type: 'Order',
 *     customer: '<- Customer.orders', // Back-reference
 *     total: 'decimal(10,2)!',
 *     items: 'json[]',
 *   }
 * })
 * ```
 *
 * @packageDocumentation
 */

import type { JsonValue, StorableData } from './types'
import type { Schema, ValidationError, ValidationResult } from './schema'

// =============================================================================
// IceType Field Modifiers and Operators
// =============================================================================

/**
 * Field modifiers that can appear at the end of a type string
 * ! = required/non-null
 * # = unique (creates unique index)
 * ? = optional (nullable)
 */
export type FieldModifier = '!' | '#' | '?'

/**
 * Relation operators for defining entity relationships
 * -> = Forward relation (direct foreign key)
 * ~> = Fuzzy forward (weak reference, AI-powered matching)
 * <- = Backward relation (reverse reference)
 * <~ = Fuzzy backward (AI-powered reverse lookup)
 */
export type RelationOperator = '->' | '~>' | '<-' | '<~'

/**
 * Primitive types supported by IceType
 */
export type PrimitiveType =
  | 'string'
  | 'text'
  | 'int'
  | 'float'
  | 'double'
  | 'decimal'
  | 'boolean'
  | 'bool'
  | 'timestamp'
  | 'timestamptz'
  | 'date'
  | 'time'
  | 'uuid'
  | 'json'
  | 'binary'
  | 'bigint'
  | 'long'
  | 'esm'      // ESM module code
  | 'vector'   // Vector embedding

// =============================================================================
// Parsed Schema Types
// =============================================================================

/**
 * Parsed field definition from IceType string
 */
export interface IceTypeField {
  name: string
  type: string
  originalType: string
  isRequired: boolean
  isOptional: boolean
  isUnique: boolean
  isIndexed: boolean
  isArray: boolean
  defaultValue?: unknown

  // Parametric type info
  precision?: number
  scale?: number
  length?: number
  dimensions?: number  // For vector[N]

  // Relation info
  relation?: IceTypeRelation

  // AI generation info
  generatedFrom?: string[]
}

/**
 * Relation definition parsed from IceType operators
 */
export interface IceTypeRelation {
  operator: RelationOperator
  targetType: string
  inverse?: string
  isArray: boolean
  onDelete?: 'cascade' | 'set_null' | 'restrict'
}

/**
 * Index directive
 */
export interface IceTypeIndex {
  fields: string[]
  unique?: boolean
  name?: string
}

/**
 * Vector field directive
 */
export interface IceTypeVector {
  field: string
  dimensions: number
  metric?: 'cosine' | 'euclidean' | 'dot'
  sourceField?: string  // For auto-embedding
}

/**
 * Schema directives (prefixed with $)
 */
export interface IceTypeDirectives {
  $type?: string
  $id?: string
  $partitionBy?: string[]
  $orderBy?: string[]
  $index?: IceTypeIndex[]
  $ttl?: number
  $seed?: unknown[]
  $readonly?: boolean
  $fts?: string[]
  $vector?: IceTypeVector[]
}

/**
 * Complete parsed IceType schema for a single entity
 */
export interface IceTypeEntitySchema {
  name: string
  fields: Map<string, IceTypeField>
  relations: Map<string, IceTypeRelation>
  directives: IceTypeDirectives
  version: number
  createdAt: number
  updatedAt: number
}

/**
 * Complete IceType database schema (multiple entities)
 */
export interface IceTypeDatabaseSchema {
  entities: Map<string, IceTypeEntitySchema>
  version: number
  createdAt: number
}

// =============================================================================
// Type String Parser
// =============================================================================

const PRIMITIVE_TYPES = new Set([
  'string', 'text', 'int', 'float', 'double', 'decimal',
  'boolean', 'bool', 'timestamp', 'timestamptz', 'date', 'time',
  'uuid', 'json', 'binary', 'bigint', 'long', 'esm', 'vector'
])

const PARAMETRIC_TYPES = new Set(['decimal', 'varchar', 'char', 'fixed', 'vector'])

const RELATION_OPERATORS: RelationOperator[] = ['->', '~>', '<-', '<~']

const TYPE_ALIASES: Record<string, string> = {
  bool: 'boolean',
  long: 'bigint',
}

/**
 * Check if a string contains a relation operator
 */
function hasRelationOperator(input: string): boolean {
  return RELATION_OPERATORS.some(op => input.includes(op))
}

/**
 * Find the relation operator and its position in the string
 */
function findRelationOperator(input: string): { operator: RelationOperator; index: number } | null {
  for (const op of RELATION_OPERATORS) {
    const index = input.indexOf(op)
    if (index !== -1) {
      return { operator: op, index }
    }
  }
  return null
}

/**
 * Parse a relation string like '-> Order[]' or '<- Customer.orders'
 */
function parseRelation(input: string): IceTypeRelation & { isArray: boolean; isOptional: boolean } {
  const trimmed = input.trim()
  const opMatch = findRelationOperator(trimmed)

  if (!opMatch) {
    throw new Error(`No relation operator found in: ${input}`)
  }

  const { operator, index } = opMatch
  let targetPart = trimmed.slice(index + operator.length).trim()

  // Extract modifiers from end
  let isArray = false
  let isOptional = false

  while (targetPart.length > 0) {
    if (targetPart.endsWith('?')) {
      isOptional = true
      targetPart = targetPart.slice(0, -1)
    } else if (targetPart.endsWith('[]')) {
      isArray = true
      targetPart = targetPart.slice(0, -2)
    } else {
      break
    }
  }

  // Check for backref: Type.field
  let targetType = targetPart
  let inverse: string | undefined

  if (targetPart.includes('.')) {
    const parts = targetPart.split('.')
    if (parts.length === 2 && parts[0] && parts[1]) {
      targetType = parts[0].trim()
      inverse = parts[1].trim()
    }
  }

  return {
    operator,
    targetType,
    inverse,
    isArray,
    isOptional,
  }
}

/**
 * Parse a type string like 'string!', 'int?', 'decimal(10,2)'
 */
function parseTypeString(input: string): Omit<IceTypeField, 'name'> {
  let str = input.trim()

  if (!str) {
    throw new Error('Empty type string')
  }

  // Check for invalid modifier position at start
  if (/^[?!#]/.test(str)) {
    throw new Error('Modifiers must come after the type name')
  }

  // 1. Extract default value (after ' = ')
  let defaultValue: unknown
  const defaultMatch = str.match(/^(.+?)\s*=\s*(.+)$/)
  if (defaultMatch?.[1] && defaultMatch[2]) {
    str = defaultMatch[1].trim()
    defaultValue = parseDefaultValue(defaultMatch[2].trim())
  }

  // 2. Extract modifiers from end (?, !, #)
  let isOptional = false
  let isUnique = false
  let isIndexed = false
  let isRequired = false

  // Also check for index directive like '#index' or '#unique'
  const indexDirectiveMatch = str.match(/#(index|unique)\s*$/)
  if (indexDirectiveMatch) {
    str = str.slice(0, -indexDirectiveMatch[0].length).trim()
    isIndexed = true
    if (indexDirectiveMatch[1] === 'unique') {
      isUnique = true
    }
  }

  while (str.length > 0) {
    const lastChar = str[str.length - 1]
    if (lastChar === '?') {
      isOptional = true
      str = str.slice(0, -1)
    } else if (lastChar === '!') {
      isRequired = true
      str = str.slice(0, -1)
    } else if (lastChar === '#') {
      isUnique = true
      isIndexed = true
      str = str.slice(0, -1)
    } else {
      break
    }
  }

  // 3. Extract array suffix []
  let isArray = false
  if (str.endsWith('[]')) {
    isArray = true
    str = str.slice(0, -2)
  }

  // 4. Check for parametric types: decimal(10,2), varchar(255), vector[1536]
  let precision: number | undefined
  let scale: number | undefined
  let length: number | undefined
  let dimensions: number | undefined

  // Vector type with brackets: vector[1536]
  const vectorMatch = str.match(/^vector\[(\d+)\]$/i)
  if (vectorMatch?.[1]) {
    return {
      type: 'vector',
      originalType: input,
      isRequired,
      isOptional,
      isUnique,
      isIndexed,
      isArray,
      dimensions: parseInt(vectorMatch[1], 10),
      defaultValue,
    }
  }

  // Parametric types with parentheses: decimal(10,2)
  const parametricMatch = str.match(/^(\w+)\((.+)\)$/)
  if (parametricMatch?.[1] && parametricMatch[2]) {
    const typeName = parametricMatch[1].toLowerCase()
    const paramsStr = parametricMatch[2].trim()

    if (!PARAMETRIC_TYPES.has(typeName)) {
      throw new Error(`Unknown parametric type: ${typeName}`)
    }

    const params = paramsStr.split(',').map(p => {
      const num = parseInt(p.trim(), 10)
      if (isNaN(num)) {
        throw new Error(`Invalid parameter value: ${p}`)
      }
      return num
    })

    if (typeName === 'decimal') {
      precision = params[0]
      scale = params.length > 1 ? params[1] : 0
    } else if (typeName === 'varchar' || typeName === 'char' || typeName === 'fixed') {
      length = params[0]
    } else if (typeName === 'vector') {
      dimensions = params[0]
    }

    return {
      type: typeName,
      originalType: input,
      isRequired,
      isOptional,
      isUnique,
      isIndexed,
      isArray,
      precision,
      scale,
      length,
      dimensions,
      defaultValue,
    }
  }

  // 5. Simple type name
  let typeName = str.toLowerCase()

  // Apply aliases
  if (TYPE_ALIASES[typeName]) {
    typeName = TYPE_ALIASES[typeName]!
  }

  return {
    type: typeName,
    originalType: input,
    isRequired,
    isOptional,
    isUnique,
    isIndexed,
    isArray,
    defaultValue,
  }
}

/**
 * Parse a default value string
 */
function parseDefaultValue(value: string): unknown {
  const trimmed = value.trim()

  // Function call: now(), uuid()
  const funcMatch = trimmed.match(/^(\w+)\(\)$/)
  if (funcMatch) {
    return { $function: funcMatch[1] }
  }

  // Literals
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (trimmed === '{}') return {}
  if (trimmed === '[]') return []

  // Quoted strings
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  // Numbers
  const num = parseFloat(trimmed)
  if (!isNaN(num)) {
    return Number.isInteger(num) && !trimmed.includes('.')
      ? parseInt(trimmed, 10)
      : num
  }

  return trimmed
}

/**
 * Parse a field definition that may include AI generation directive
 * e.g., 'text ~> name,email' means generate text from name and email fields
 */
function parseFieldWithGeneration(input: string): { field: Omit<IceTypeField, 'name'>; generatedFrom?: string[] } {
  const trimmed = input.trim()

  // Check for AI generation directive: 'type ~> sourceField' or 'type ~> field1,field2'
  // But not for relations which also use ~>
  const genMatch = trimmed.match(/^([^~]+)\s+~>\s+(.+)$/)
  if (genMatch && !hasRelationOperator(trimmed)) {
    const typeStr = genMatch[1]!.trim()
    const sourcesStr = genMatch[2]!.trim()

    const field = parseTypeString(typeStr)
    const generatedFrom = sourcesStr.split(',').map(s => s.trim())

    return { field, generatedFrom }
  }

  return { field: parseTypeString(trimmed) }
}

// =============================================================================
// IceType Parser Class
// =============================================================================

/**
 * IceType schema parser
 */
export class IceTypeParser {
  /**
   * Parse a complete entity definition
   */
  parseEntity(name: string, definition: Record<string, unknown>): IceTypeEntitySchema {
    const fields = new Map<string, IceTypeField>()
    const relations = new Map<string, IceTypeRelation>()
    const directives = this.parseDirectives(definition)

    for (const [key, value] of Object.entries(definition)) {
      // Skip directives
      if (key.startsWith('$')) continue

      if (typeof value === 'string') {
        const fieldDef = this.parseField(key, value)
        fields.set(key, fieldDef)

        if (fieldDef.relation) {
          relations.set(key, fieldDef.relation)
        }
      } else if (typeof value === 'object' && value !== null) {
        // Nested object - treat as JSON field
        fields.set(key, {
          name: key,
          type: 'json',
          originalType: 'json',
          isRequired: false,
          isOptional: true,
          isUnique: false,
          isIndexed: false,
          isArray: false,
        })
      }
    }

    const now = Date.now()

    return {
      name: directives.$type || name,
      fields,
      relations,
      directives,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Parse a single field definition string
   */
  parseField(name: string, value: string): IceTypeField {
    const trimmed = value.trim()

    // Check if it's a relation
    if (hasRelationOperator(trimmed)) {
      const relation = parseRelation(trimmed)
      return {
        name,
        type: relation.targetType,
        originalType: trimmed,
        isRequired: !relation.isOptional,
        isOptional: relation.isOptional,
        isUnique: false,
        isIndexed: false,
        isArray: relation.isArray,
        relation,
      }
    }

    // Parse type with possible AI generation
    const { field, generatedFrom } = parseFieldWithGeneration(trimmed)

    return {
      ...field,
      name,
      generatedFrom,
    }
  }

  /**
   * Parse directives from an entity definition
   */
  parseDirectives(definition: Record<string, unknown>): IceTypeDirectives {
    const directives: IceTypeDirectives = {}

    for (const [key, value] of Object.entries(definition)) {
      if (!key.startsWith('$')) continue

      switch (key) {
        case '$type':
          directives.$type = value as string
          break

        case '$id':
          directives.$id = value as string
          break

        case '$partitionBy':
          directives.$partitionBy = Array.isArray(value) ? value as string[] : [value as string]
          break

        case '$orderBy':
          directives.$orderBy = Array.isArray(value) ? value as string[] : [value as string]
          break

        case '$index':
          if (Array.isArray(value)) {
            directives.$index = value.map(v => {
              if (Array.isArray(v)) {
                return { fields: v as string[], unique: false }
              }
              return v as IceTypeIndex
            })
          }
          break

        case '$ttl':
          directives.$ttl = value as number
          break

        case '$seed':
          directives.$seed = value as unknown[]
          break

        case '$readonly':
          directives.$readonly = value as boolean
          break

        case '$fts':
          directives.$fts = Array.isArray(value) ? value as string[] : [value as string]
          break

        case '$vector':
          if (typeof value === 'object' && value !== null) {
            directives.$vector = Object.entries(value).map(([field, config]) => {
              if (typeof config === 'number') {
                return { field, dimensions: config }
              }
              return { field, ...(config as Omit<IceTypeVector, 'field'>) }
            })
          }
          break
      }
    }

    return directives
  }

  /**
   * Validate a parsed entity schema
   */
  validateEntity(schema: IceTypeEntitySchema): ValidationResult {
    const errors: ValidationError[] = []

    // Validate fields
    for (const [fieldName, field] of schema.fields) {
      // Check for valid type
      if (!field.relation && !this.isValidType(field.type)) {
        errors.push({
          field: fieldName,
          message: `Unknown type: ${field.type}`,
        })
      }
    }

    // Validate relations
    for (const [relName, relation] of schema.relations) {
      if (!relation.targetType) {
        errors.push({
          field: relName,
          message: 'Relation missing target type',
        })
      }
    }

    // Validate directives reference existing fields
    if (schema.directives.$fts) {
      for (const field of schema.directives.$fts) {
        if (!schema.fields.has(field)) {
          errors.push({
            field: `$fts.${field}`,
            message: `FTS field '${field}' does not exist`,
          })
        }
      }
    }

    if (schema.directives.$vector) {
      for (const vec of schema.directives.$vector) {
        if (!schema.fields.has(vec.field)) {
          errors.push({
            field: `$vector.${vec.field}`,
            message: `Vector field '${vec.field}' does not exist`,
          })
        }
        if (vec.dimensions <= 0) {
          errors.push({
            field: `$vector.${vec.field}`,
            message: 'Vector dimensions must be positive',
          })
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  private isValidType(type: string): boolean {
    const normalized = type.toLowerCase()
    return PRIMITIVE_TYPES.has(normalized) ||
           PARAMETRIC_TYPES.has(normalized) ||
           normalized === 'reference' ||
           normalized === 'enum' ||
           normalized === 'array'
  }
}

// =============================================================================
// IceType Factory Function
// =============================================================================

/**
 * Input type for IceType schema definition
 * Each key is an entity name, value is the entity definition
 */
export type IceTypeSchemaInput = Record<string, Record<string, unknown>>

/**
 * Create an IceType database schema from definition
 *
 * @example
 * ```typescript
 * const schema = IceType({
 *   User: {
 *     $type: 'User',
 *     name: 'string!',
 *     email: 'string! #unique',
 *     posts: '-> Post[]',
 *     $fts: ['name', 'email'],
 *   },
 *   Post: {
 *     $type: 'Post',
 *     title: 'string!',
 *     content: 'text',
 *     author: '<- User.posts',
 *     summary: 'text ~> title,content',
 *   }
 * })
 * ```
 */
export function IceType(input: IceTypeSchemaInput): IceTypeDatabaseSchema {
  const parser = new IceTypeParser()
  const entities = new Map<string, IceTypeEntitySchema>()

  for (const [name, definition] of Object.entries(input)) {
    const entitySchema = parser.parseEntity(name, definition)
    entities.set(entitySchema.name, entitySchema)
  }

  return {
    entities,
    version: 1,
    createdAt: Date.now(),
  }
}

/**
 * Alias for IceType - matches db4's DB() API
 */
export const DB = IceType

// =============================================================================
// Type Inference Utilities
// =============================================================================

/**
 * Map IceType types to TypeScript types
 */
type IceTypeToTS<T extends string> =
  T extends 'string' | 'text' | 'uuid' | 'esm' ? string :
  T extends 'int' | 'float' | 'double' | 'decimal' | 'bigint' | 'long' ? number :
  T extends 'boolean' | 'bool' ? boolean :
  T extends 'timestamp' | 'timestamptz' | 'date' | 'time' ? number :
  T extends 'json' ? JsonValue :
  T extends 'binary' ? ArrayBuffer :
  T extends 'vector' ? number[] :
  unknown

/**
 * Infer TypeScript type from an IceType field definition
 * This provides compile-time type safety when using IceType schemas
 */
export type InferIceTypeField<F extends string> =
  F extends `${infer T}[]` ? IceTypeToTS<T>[] :
  F extends `${infer T}!` ? IceTypeToTS<T> :
  F extends `${infer T}?` ? IceTypeToTS<T> | null :
  F extends `${infer T}#` ? IceTypeToTS<T> :
  F extends `-> ${infer _Target}[]` ? string[] :  // Array of IDs
  F extends `-> ${infer _Target}` ? string :      // Single ID
  F extends `<- ${infer _Target}` ? string :      // Back-reference ID
  F extends `~> ${infer _Target}` ? string :      // Fuzzy reference
  F extends `<~ ${infer _Target}` ? string :      // Fuzzy back-ref
  unknown

// =============================================================================
// Schema-to-Validation Bridge
// =============================================================================

/**
 * Convert an IceType entity schema to a validation Schema
 * This bridges IceType definitions to the existing @dotdo/db schema validation
 */
export function iceTypeToSchema<T extends StorableData>(
  entitySchema: IceTypeEntitySchema
): Schema<T> {
  const $type = entitySchema.name

  function mapFieldToValidator(field: IceTypeField): (value: unknown) => ValidationError[] {
    return (value: unknown) => {
      const errors: ValidationError[] = []

      // Handle null/undefined
      if (value === null || value === undefined) {
        if (field.isRequired) {
          errors.push({
            field: field.name,
            message: 'Field is required',
            value: null,
          })
        }
        return errors
      }

      // Skip validation for relations - they're just IDs
      if (field.relation) {
        if (field.isArray && !Array.isArray(value)) {
          errors.push({
            field: field.name,
            message: 'Expected array of IDs',
            value: value as JsonValue,
          })
        }
        return errors
      }

      // Type validation
      switch (field.type) {
        case 'string':
        case 'text':
        case 'uuid':
        case 'esm':
          if (typeof value !== 'string') {
            errors.push({
              field: field.name,
              message: `Expected string, got ${typeof value}`,
              value: value as JsonValue,
            })
          }
          break

        case 'int':
        case 'bigint':
        case 'long':
          if (typeof value !== 'number' || !Number.isInteger(value)) {
            errors.push({
              field: field.name,
              message: `Expected integer, got ${typeof value}`,
              value: value as JsonValue,
            })
          }
          break

        case 'float':
        case 'double':
        case 'decimal':
          if (typeof value !== 'number') {
            errors.push({
              field: field.name,
              message: `Expected number, got ${typeof value}`,
              value: value as JsonValue,
            })
          }
          break

        case 'boolean':
        case 'bool':
          if (typeof value !== 'boolean') {
            errors.push({
              field: field.name,
              message: `Expected boolean, got ${typeof value}`,
              value: value as JsonValue,
            })
          }
          break

        case 'timestamp':
        case 'timestamptz':
        case 'date':
        case 'time':
          if (typeof value !== 'number' && typeof value !== 'string') {
            errors.push({
              field: field.name,
              message: `Expected timestamp (number or ISO string), got ${typeof value}`,
              value: value as JsonValue,
            })
          }
          break

        case 'json':
          // JSON accepts any JSON-serializable value
          break

        case 'vector':
          if (!Array.isArray(value) || !value.every(v => typeof v === 'number')) {
            errors.push({
              field: field.name,
              message: 'Expected array of numbers for vector',
              value: value as JsonValue,
            })
          } else if (field.dimensions && value.length !== field.dimensions) {
            errors.push({
              field: field.name,
              message: `Vector must have ${field.dimensions} dimensions, got ${value.length}`,
              value: value as JsonValue,
            })
          }
          break
      }

      // Array validation
      if (field.isArray && !Array.isArray(value)) {
        errors.push({
          field: field.name,
          message: `Expected array, got ${typeof value}`,
          value: value as JsonValue,
        })
      }

      return errors
    }
  }

  const fieldValidators = new Map<string, (value: unknown) => ValidationError[]>()
  for (const [name, field] of entitySchema.fields) {
    fieldValidators.set(name, mapFieldToValidator(field))
  }

  return {
    $type,
    fields: Object.fromEntries(
      Array.from(entitySchema.fields.entries()).map(([name, field]) => [
        name,
        { type: field.type, required: field.isRequired }
      ])
    ),
    strict: false,

    validate(data: Record<string, unknown>): ValidationResult {
      const errors: ValidationError[] = []

      for (const [name, validator] of fieldValidators) {
        const fieldErrors = validator(data[name])
        errors.push(...fieldErrors)
      }

      return {
        valid: errors.length === 0,
        errors,
      }
    },

    parse(data: Record<string, unknown>): T {
      const result = this.validate(data)
      if (!result.valid) {
        const messages = result.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        throw new Error(`Validation failed: ${messages}`)
      }
      return data as T
    },

    safeParse(data: Record<string, unknown>) {
      const result = this.validate(data)
      if (result.valid) {
        return { success: true as const, data: data as T }
      }
      return { success: false as const, errors: result.errors }
    },
  }
}

// =============================================================================
// Default Parser Instance
// =============================================================================

export const iceTypeParser = new IceTypeParser()

/**
 * Parse a single field definition string
 */
export function parseField(name: string, value: string): IceTypeField {
  return iceTypeParser.parseField(name, value)
}

/**
 * Parse an entity definition
 */
export function parseEntity(name: string, definition: Record<string, unknown>): IceTypeEntitySchema {
  return iceTypeParser.parseEntity(name, definition)
}

/**
 * Parse schema directives
 */
export function parseDirectives(definition: Record<string, unknown>): IceTypeDirectives {
  return iceTypeParser.parseDirectives(definition)
}

/**
 * Validate an entity schema
 */
export function validateEntitySchema(schema: IceTypeEntitySchema): ValidationResult {
  return iceTypeParser.validateEntity(schema)
}

/**
 * Infer TypeScript type from a JavaScript value (for schemaless mode)
 */
export function inferType(value: unknown): string {
  if (value === null) return 'json?'
  if (value === undefined) return 'json?'

  switch (typeof value) {
    case 'string': {
      // Check for UUID pattern
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        return 'uuid'
      }
      // Check for ISO timestamp
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        return 'timestamp'
      }
      // Check for date
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return 'date'
      }
      return 'string'
    }

    case 'number': {
      if (Number.isInteger(value)) {
        if (value > 2147483647 || value < -2147483648) {
          return 'bigint'
        }
        return 'int'
      }
      return 'float'
    }

    case 'boolean':
      return 'bool'

    case 'object': {
      if (Array.isArray(value)) {
        if (value.length === 0) return 'json[]'
        const elementType = inferType(value[0])
        return `${elementType}[]`
      }
      if (value instanceof Date) {
        return 'timestamp'
      }
      if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
        return 'binary'
      }
      return 'json'
    }

    case 'bigint':
      return 'bigint'

    default:
      return 'json'
  }
}
