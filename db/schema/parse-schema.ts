/**
 * Schema Parser for Cascade Generation System
 *
 * Parses schema definitions into structured LegacyParsedSchema objects.
 */

import type {
  SchemaDefinition,
  SchemaMetadata,
  LegacyParsedSchema,
  LegacyParsedType,
  LegacyParsedField,
  CascadeOperator,
} from './types'

// Re-export types for convenience (using legacy types for backwards compatibility)
export type { SchemaDefinition, SchemaMetadata }
export type { LegacyParsedSchema as LegacyParsedSchema, LegacyParsedType as LegacyParsedType, LegacyParsedField as LegacyParsedField }

/**
 * Check if a key is a PascalCase type name (starts with uppercase letter A-Z)
 */
export function isPascalCase(key: string): boolean {
  if (!key) return false
  const firstChar = key.charCodeAt(0)
  return firstChar >= 65 && firstChar <= 90  // A-Z
}

/**
 * Check if a key is a $ directive
 */
function isDirective(key: string): boolean {
  return key.startsWith('$')
}

/**
 * Unified regex to match all cascade operators: ->, ~>, <-, <~
 * Captures: (prompt)(operator)(reference)(optional?)
 */
const OPERATOR_PATTERN = /^(.*?)(<-|<~|->|~>)(\w+)(\??)$/

/**
 * Pattern to identify simple type declarations (lowercase word with optional ?)
 */
const SIMPLE_TYPE_PATTERN = /^([a-z]+)(\??)$/

/**
 * Parse a field value string to extract type, operator, reference, and prompt
 *
 * Examples:
 * - 'string' -> { type: 'string', required: true }
 * - 'string?' -> { type: 'string', required: false }
 * - '->User' -> { type: 'reference', operator: '->', reference: 'User', required: true }
 * - 'What is the idea? <-Idea' -> { type: 'reference', operator: '<-', reference: 'Idea', prompt: 'What is the idea?' }
 * - '->Node?' -> { type: 'reference', operator: '->', reference: 'Node', required: false }
 */
function parseFieldValue(value: string): Partial<LegacyParsedField> {
  // Try to match a cascade operator
  const operatorMatch = value.match(OPERATOR_PATTERN)
  if (operatorMatch) {
    const [, promptPart, operator, reference, optional] = operatorMatch
    const prompt = promptPart.trim()
    return {
      type: 'reference',
      operator: operator as CascadeOperator,
      reference,
      required: optional !== '?',
      ...(prompt && { prompt }),
    }
  }

  // Try to match a simple type declaration
  const typeMatch = value.match(SIMPLE_TYPE_PATTERN)
  if (typeMatch) {
    const [, type, optional] = typeMatch
    return {
      type,
      required: optional !== '?',
    }
  }

  // It's a prompt without an operator
  return {
    type: 'string',
    prompt: value,
    required: true,
  }
}

/**
 * Parse a field definition (can be string, array, or nested object)
 */
function parseField(name: string, value: unknown): LegacyParsedField {
  const field: LegacyParsedField = {
    name,
    type: 'unknown',
    required: true,
  }

  if (typeof value === 'string') {
    // Simple string field definition
    const parsed = parseFieldValue(value)
    Object.assign(field, parsed)
  } else if (Array.isArray(value)) {
    // Array field
    field.isArray = true

    if (value.length > 0) {
      const firstElement = value[0]

      if (typeof firstElement === 'string') {
        // Array of primitives or references: ['string'] or ['->Type']
        const parsed = parseFieldValue(firstElement)
        Object.assign(field, parsed)
      } else if (typeof firstElement === 'object' && firstElement !== null) {
        // Array of nested objects: [{ product: '->Product', quantity: 'number' }]
        field.isNested = true
        field.nestedFields = parseFieldsFromObject(firstElement as Record<string, unknown>)
        field.type = 'object'
      }
    }
  } else if (typeof value === 'object' && value !== null) {
    // Nested object field
    field.isNested = true
    field.nestedFields = parseFieldsFromObject(value as Record<string, unknown>)
    field.type = 'object'
  }

  return field
}

/**
 * Parse fields from an object definition
 */
function parseFieldsFromObject(obj: Record<string, unknown>): LegacyParsedField[] {
  const fields: LegacyParsedField[] = []

  for (const [key, value] of Object.entries(obj)) {
    // Skip $ directives
    if (isDirective(key)) continue

    fields.push(parseField(key, value))
  }

  return fields
}

/**
 * Parse a type definition
 */
function parseType(name: string, definition: Record<string, unknown>): LegacyParsedType {
  return {
    name,
    fields: parseFieldsFromObject(definition),
  }
}

/** Metadata keys to extract from schema definition */
const METADATA_KEYS = ['$id', '$context', '$version', '$fn'] as const

/**
 * Extract metadata from schema definition
 */
function extractMetadata(def: SchemaDefinition): SchemaMetadata {
  const metadata: SchemaMetadata = {}
  for (const key of METADATA_KEYS) {
    if (def[key] !== undefined) {
      ;(metadata as Record<string, unknown>)[key] = def[key]
    }
  }
  return metadata
}

/**
 * Parse a schema definition into a structured LegacyParsedSchema
 */
export function parseSchema(def: SchemaDefinition): LegacyParsedSchema {
  const metadata = extractMetadata(def)
  const types: LegacyParsedType[] = []

  // Extract types from PascalCase keys
  for (const [key, value] of Object.entries(def)) {
    // Skip $ directives and non-PascalCase keys
    if (isDirective(key)) continue
    if (!isPascalCase(key)) continue

    // Value must be an object (type definition)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue

    types.push(parseType(key, value as Record<string, unknown>))
  }

  // Build helper functions
  const typeMap = new Map<string, LegacyParsedType>()
  for (const type of types) {
    typeMap.set(type.name, type)
  }

  return {
    metadata,
    types,
    getType: (name: string) => typeMap.get(name),
    hasType: (name: string) => typeMap.has(name),
    getFieldsForType: (name: string) => typeMap.get(name)?.fields ?? [],
  }
}
