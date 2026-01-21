/**
 * Unified Schema Parser
 *
 * Parses both IceType modifiers and ai-database prompt fields into a normalized
 * schema definition. Supports:
 *
 * - IceType modifiers: !, ?, #, [], ->, <-, ~>, <~
 * - ai-database prompt fields (strings with spaces/natural language)
 * - Relation operators for connecting entities
 * - Schema directives ($instructions, $fuzzyThreshold, etc.)
 *
 * @module do/schema/parser
 */

import type {
  FieldDefinition,
  RelationDefinition,
  RelationOperator,
  RelationDirection,
  MatchMode,
  EntitySchema,
  SchemaDirectives,
  RawEntitySchema,
  RawDatabaseSchema,
  RawFieldDefinition,
  ParsedFieldResult,
  UnifiedSchema,
} from './types'

// =============================================================================
// Constants
// =============================================================================

/** IceType primitive type keywords */
const PRIMITIVE_TYPES = new Set([
  'string', 'text', 'int', 'long', 'bigint', 'float', 'double',
  'bool', 'boolean', 'timestamp', 'timestamptz', 'date', 'time',
  'uuid', 'json', 'binary', 'number', 'datetime', 'markdown', 'url'
])

/** Relation operators */
const RELATION_OPERATORS: RelationOperator[] = ['->', '<-', '~>', '<~']

/** Schema directive keys ($ prefixed) */
const DIRECTIVE_KEYS = new Set([
  '$instructions', '$fuzzyThreshold', '$index', '$partitionBy',
  '$fts', '$vector', '$type', '$id', '$context', '$seed',
  '$readonly', '$ttl', '$orderBy'
])

// =============================================================================
// Type Detection
// =============================================================================

/**
 * Check if a field value starts with a relation operator
 */
export function isRelationField(value: string): boolean {
  const trimmed = value.trim()
  return RELATION_OPERATORS.some(op => trimmed.startsWith(op))
}

/**
 * Check if a type string is a primitive type or looks like an entity reference
 */
function isPrimitiveOrEntityType(type: string): boolean {
  // Remove array brackets if present
  const baseType = type.replace(/\[\]$/, '')

  // Check primitives
  if (PRIMITIVE_TYPES.has(baseType.toLowerCase())) {
    return true
  }

  // Entity names are PascalCase
  if (/^[A-Z][a-zA-Z0-9]*$/.test(baseType)) {
    return true
  }

  // Parametric types like decimal(10,2)
  if (/^\w+\(\d+(?:,\d+)?\)$/.test(baseType)) {
    return true
  }

  return false
}

/**
 * Check if a field value looks like an ai-database prompt field.
 * Prompts have spaces, questions marks, or natural language patterns.
 */
export function isPromptField(value: string): boolean {
  // First check if it's a relation field - relations are NOT prompts
  if (isRelationField(value)) {
    return false
  }

  // Contains spaces - likely natural language
  if (value.includes(' ')) {
    return true
  }
  // Contains question mark - likely a prompt
  if (value.includes('?')) {
    // But not optional modifier at the end
    if (value.endsWith('?') && !value.includes(' ')) {
      // Check if it's type? pattern (optional)
      const withoutModifier = value.slice(0, -1)
      if (isPrimitiveOrEntityType(withoutModifier)) {
        return false
      }
    }
    return true
  }
  return false
}

// =============================================================================
// Field Parsing
// =============================================================================

/**
 * Parse a relation string into a RelationDefinition.
 *
 * @param value - The relation string to parse
 * @returns Parsed relation definition
 *
 * @example
 * ```ts
 * parseRelation('->User')
 * // => { operator: '->', direction: 'forward', matchMode: 'exact', targetType: 'User' }
 *
 * parseRelation('~>Category')
 * // => { operator: '~>', direction: 'forward', matchMode: 'fuzzy', targetType: 'Category' }
 *
 * parseRelation('<-Post.author[]')
 * // => { operator: '<-', direction: 'backward', matchMode: 'exact',
 * //      targetType: 'Post', backref: 'author', array: true }
 * ```
 */
export function parseRelation(value: string): RelationDefinition {
  // Find which operator is used
  let operator: RelationOperator | null = null
  let rest = value.trim()

  for (const op of RELATION_OPERATORS) {
    if (rest.startsWith(op)) {
      operator = op
      rest = rest.slice(op.length).trim()
      break
    }
  }

  if (!operator) {
    throw new Error(`No valid relation operator found in '${value}'. Use ->, ~>, <-, or <~`)
  }

  // Determine direction and match mode
  const direction: RelationDirection = operator.startsWith('<') ? 'backward' : 'forward'
  const matchMode: MatchMode = operator.includes('~') ? 'fuzzy' : 'exact'

  // Parse the target (may include backref and modifiers)
  let targetType = rest
  let backref: string | undefined
  let array = false
  let optional = false
  let threshold: number | undefined
  let unionTypes: string[] | undefined

  // Check for array suffix
  if (targetType.endsWith('[]')) {
    array = true
    targetType = targetType.slice(0, -2)
  }

  // Check for optional suffix
  if (targetType.endsWith('?')) {
    optional = true
    targetType = targetType.slice(0, -1)
  }

  // Parse threshold from ~>Type(0.9) syntax
  const thresholdMatch = targetType.match(/^([^(]+)\(([0-9.]+)\)$/)
  if (thresholdMatch && thresholdMatch[1] && thresholdMatch[2]) {
    const thresholdValue = parseFloat(thresholdMatch[2])
    if (!isNaN(thresholdValue) && thresholdValue >= 0 && thresholdValue <= 1) {
      threshold = thresholdValue
      targetType = thresholdMatch[1]
    }
  }

  // Check for backref (e.g., User.owner)
  if (targetType.includes('.')) {
    const parts = targetType.split('.')
    targetType = parts[0]!
    backref = parts.slice(1).join('.')
  }

  // Parse union types from A|B|C syntax
  if (targetType.includes('|')) {
    unionTypes = targetType
      .split('|')
      .map(t => t.trim())
      .filter(Boolean)
    if (unionTypes.length > 0) {
      targetType = unionTypes[0]!
    }
  }

  const relation: RelationDefinition = {
    operator,
    direction,
    matchMode,
    targetType,
    ...(backref && { backref }),
    ...(array && { array }),
    ...(optional && { optional }),
    ...(threshold !== undefined && { threshold }),
    ...(unionTypes && unionTypes.length > 1 && { unionTypes }),
  }

  return relation
}

/**
 * Parse a relation field definition.
 * Examples:
 *   -> User        (forward exact, single)
 *   -> User?       (forward exact, optional)
 *   <- User.owner  (backward exact from User.owner field)
 *   <- User.owner[]  (backward exact, array)
 *   ~> Category    (forward fuzzy)
 *   <~ Product.vendor[] (backward fuzzy, array)
 */
function parseRelationField(fieldName: string, value: string): ParsedFieldResult {
  // Find which operator is used
  let operator: RelationOperator | null = null
  let rest = value

  for (const op of RELATION_OPERATORS) {
    if (value.startsWith(op)) {
      operator = op
      rest = value.slice(op.length).trim()
      break
    }
  }

  if (!operator) {
    throw new Error(`Invalid relation field: ${value}`)
  }

  // Determine direction and match mode
  const direction: RelationDirection = operator.startsWith('<') ? 'backward' : 'forward'
  const matchMode: MatchMode = operator.includes('~') ? 'fuzzy' : 'exact'

  // Parse the target (may include backref and modifiers)
  // Format: TargetType.backrefField? or TargetType.backrefField[]
  let targetType = rest
  let backref: string | undefined
  let array = false
  let optional = false

  // Check for array suffix
  if (targetType.endsWith('[]')) {
    array = true
    targetType = targetType.slice(0, -2)
  }

  // Check for optional suffix
  if (targetType.endsWith('?')) {
    optional = true
    targetType = targetType.slice(0, -1)
  }

  // Check for backref (e.g., User.owner)
  if (targetType.includes('.')) {
    const parts = targetType.split('.')
    targetType = parts[0]
    backref = parts.slice(1).join('.')
  }

  const relation: RelationDefinition = {
    operator,
    direction,
    matchMode,
    targetType,
    ...(backref && { backref }),
    ...(array && { array }),
    ...(optional && { optional }),
  }

  return {
    type: targetType,
    required: !optional,
    optional,
    indexed: false,
    unique: false,
    array,
    relation,
    generated: false,
  }
}

/**
 * Parse a single field definition string.
 *
 * IceType syntax:
 *   string!     -> { type: 'string', required: true }
 *   int?        -> { type: 'int', optional: true }
 *   string#     -> { type: 'string', indexed: true }
 *   string!#    -> { type: 'string', required: true, indexed: true }
 *   decimal(10,2) -> { type: 'decimal', precision: 10, scale: 2 }
 *   string[]    -> { type: 'string', array: true }
 *
 * ai-database prompt:
 *   "A compelling description" -> { type: 'string', prompt: '...', generated: true }
 */
export function parseFieldDefinition(fieldName: string, value: RawFieldDefinition): ParsedFieldResult {
  // Handle array literal syntax: ['string']
  if (Array.isArray(value)) {
    const innerResult = parseFieldDefinition(fieldName, value[0])
    return { ...innerResult, array: true }
  }

  // Check for prompt field first (before any other parsing)
  if (isPromptField(value)) {
    return {
      type: 'string',
      required: false,
      optional: true,
      indexed: false,
      unique: false,
      array: false,
      prompt: value,
      generated: true,
    }
  }

  // Check for relation field
  if (isRelationField(value)) {
    return parseRelationField(fieldName, value)
  }

  // Parse IceType syntax
  let type = value
  let required = false
  let optional = false
  let indexed = false
  let unique = false
  let array = false
  let precision: number | undefined
  let scale: number | undefined
  let length: number | undefined
  let defaultValue: unknown

  // Extract modifiers from the end (! # ?) - BEFORE checking for array
  // This handles string[]? correctly (optional array)
  const modifiers = new Set<string>()
  while (type.length > 0) {
    const lastChar = type[type.length - 1]
    if (lastChar === '!' || lastChar === '#' || lastChar === '?') {
      modifiers.add(lastChar)
      type = type.slice(0, -1)
    } else {
      break
    }
  }

  // Check for array suffix AFTER extracting modifiers
  if (type.endsWith('[]')) {
    array = true
    type = type.slice(0, -2)
  }

  // Apply modifiers
  if (modifiers.has('!')) {
    required = true
  }
  if (modifiers.has('?')) {
    optional = true
  }
  if (modifiers.has('#')) {
    indexed = true
    unique = true // # implies unique index
  }

  // Default: if no required/optional modifier, default to optional
  if (!required && !optional) {
    optional = true
  }

  // Parse parametric types: decimal(10,2), varchar(255)
  const paramMatch = type.match(/^(\w+)\((\d+)(?:,(\d+))?\)$/)
  if (paramMatch) {
    type = paramMatch[1]
    const param1 = parseInt(paramMatch[2], 10)
    const param2 = paramMatch[3] ? parseInt(paramMatch[3], 10) : undefined

    if (type === 'decimal' || type === 'fixed') {
      precision = param1
      scale = param2
    } else if (type === 'varchar' || type === 'char') {
      length = param1
    }
  }

  // Normalize type aliases
  if (type === 'bool') {
    type = 'boolean'
  }

  return {
    type,
    required,
    optional,
    indexed,
    unique,
    array,
    ...(precision !== undefined && { precision }),
    ...(scale !== undefined && { scale }),
    ...(length !== undefined && { length }),
    ...(defaultValue !== undefined && { defaultValue }),
    generated: false,
  }
}

// =============================================================================
// Entity Schema Parsing
// =============================================================================

/**
 * Extract schema directives from a raw entity schema
 */
function extractDirectives(raw: RawEntitySchema): SchemaDirectives {
  const directives: SchemaDirectives = {}

  for (const key of Object.keys(raw)) {
    if (DIRECTIVE_KEYS.has(key)) {
      const value = raw[key]
      switch (key) {
        case '$instructions':
          directives.$instructions = value as string
          break
        case '$fuzzyThreshold':
          directives.$fuzzyThreshold = value as number
          break
        case '$index':
          directives.$index = value as string[][]
          break
        case '$partitionBy':
          directives.$partitionBy = value as string[]
          break
        case '$fts':
          directives.$fts = value as string[]
          break
        case '$vector':
          directives.$vector = value as Record<string, number>
          break
        case '$type':
          directives.$type = value as string
          break
        case '$id':
          directives.$id = value as string
          break
        case '$context':
          directives.$context = value as string | Record<string, unknown>
          break
        case '$seed':
          directives.$seed = value as string
          break
        case '$readonly':
          directives.$readonly = value as boolean
          break
        case '$ttl':
          directives.$ttl = value as number
          break
        case '$orderBy':
          directives.$orderBy = value as string
          break
      }
    }
  }

  return directives
}

/**
 * Parse a single entity schema definition
 */
export function parseEntitySchema(name: string, raw: RawEntitySchema): EntitySchema {
  const fields = new Map<string, FieldDefinition>()
  const relations = new Map<string, RelationDefinition>()
  const directives = extractDirectives(raw)
  const now = Date.now()

  for (const [fieldName, fieldValue] of Object.entries(raw)) {
    // Skip directive keys
    if (DIRECTIVE_KEYS.has(fieldName)) {
      continue
    }

    // Parse the field
    const parsed = parseFieldDefinition(fieldName, fieldValue as RawFieldDefinition)

    // Create field definition
    const fieldDef: FieldDefinition = {
      name: fieldName,
      type: parsed.type,
      modifier: parsed.required ? '!' : (parsed.indexed ? '#' : (parsed.optional ? '?' : '')),
      required: parsed.required,
      optional: parsed.optional,
      indexed: parsed.indexed,
      unique: parsed.unique,
      array: parsed.array,
      ...(parsed.defaultValue !== undefined && { defaultValue: parsed.defaultValue }),
      ...(parsed.precision !== undefined && { precision: parsed.precision }),
      ...(parsed.scale !== undefined && { scale: parsed.scale }),
      ...(parsed.length !== undefined && { length: parsed.length }),
      ...(parsed.relation && { relation: parsed.relation }),
      ...(parsed.prompt && { prompt: parsed.prompt }),
      generated: parsed.generated,
    }

    fields.set(fieldName, fieldDef)

    // Track relations separately for easy lookup
    if (parsed.relation) {
      relations.set(fieldName, parsed.relation)
    }
  }

  return {
    name,
    fields,
    directives,
    relations,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

// =============================================================================
// Database Schema Parsing
// =============================================================================

/**
 * Parse a complete database schema definition.
 *
 * @example
 * ```typescript
 * const schema = parseSchema({
 *   Product: {
 *     sku: 'string!#',
 *     name: 'string!',
 *     price: 'decimal(10,2)!',
 *     description: 'A compelling product description',
 *     vendor: '-> Vendor?',
 *   },
 *   Vendor: {
 *     name: 'string!',
 *     products: '<- Product.vendor[]',
 *   },
 * })
 * ```
 */
export function parseSchema(raw: RawDatabaseSchema): UnifiedSchema {
  const entities = new Map<string, EntitySchema>()

  for (const [entityName, entityDef] of Object.entries(raw)) {
    const parsed = parseEntitySchema(entityName, entityDef)
    entities.set(entityName, parsed)
  }

  // Resolve backrefs between entities
  resolveBackrefs(entities)

  return { entities }
}

/**
 * Resolve bidirectional backrefs between entities.
 * When entity A has `<- B.fieldName`, ensure B.fieldName points to A.
 */
function resolveBackrefs(entities: Map<string, EntitySchema>): void {
  for (const [entityName, schema] of entities) {
    for (const [fieldName, relation] of schema.relations) {
      // Only process backward relations
      if (relation.direction !== 'backward') {
        continue
      }

      const targetEntity = entities.get(relation.targetType)
      if (!targetEntity) {
        continue // Target entity not in schema, skip
      }

      // If backref specified, verify it exists in target
      if (relation.backref) {
        const targetField = targetEntity.fields.get(relation.backref)
        if (!targetField?.relation) {
          // Create implicit forward relation in target
          const implicitRelation: RelationDefinition = {
            operator: '->',
            direction: 'forward',
            matchMode: relation.matchMode,
            targetType: entityName,
            backref: fieldName,
          }

          const implicitField: FieldDefinition = {
            name: relation.backref,
            type: entityName,
            modifier: '',
            required: false,
            optional: true,
            indexed: false,
            unique: false,
            array: false,
            relation: implicitRelation,
            generated: false,
          }

          targetEntity.fields.set(relation.backref, implicitField)
          targetEntity.relations.set(relation.backref, implicitRelation)
        }
      }
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get all entity names from a parsed schema
 */
export function getEntityNames(schema: UnifiedSchema): string[] {
  return Array.from(schema.entities.keys())
}

/**
 * Get all fields that are relations for an entity
 */
export function getRelationFields(schema: UnifiedSchema, entityName: string): Map<string, RelationDefinition> {
  const entity = schema.entities.get(entityName)
  return entity?.relations ?? new Map()
}

/**
 * Check if a field is a generated (AI) field
 */
export function isGeneratedField(schema: UnifiedSchema, entityName: string, fieldName: string): boolean {
  const entity = schema.entities.get(entityName)
  const field = entity?.fields.get(fieldName)
  return field?.generated ?? false
}
