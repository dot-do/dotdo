/**
 * Schema Parser for Cascade Generation System
 *
 * Parses schema definitions into structured LegacyParsedSchema objects.
 * Now delegates to the centralized schema-parser for operator parsing.
 */

import type {
  SchemaDefinition,
  SchemaMetadata,
  LegacyParsedSchema,
  LegacyParsedType,
  LegacyParsedField,
  CascadeOperator,
} from './types'
import {
  defaultParser,
  CascadeSchemaError,
  PRIMITIVE_TYPES,
} from './schema-parser'

// Re-export types for convenience (using legacy types for backwards compatibility)
export type { SchemaDefinition, SchemaMetadata }
export type { LegacyParsedSchema as LegacyParsedSchema, LegacyParsedType as LegacyParsedType, LegacyParsedField as LegacyParsedField }

// Re-export error types
export { CascadeSchemaError }

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
 * Pattern to identify simple type declarations (lowercase word with optional ?)
 */
const SIMPLE_TYPE_PATTERN = /^([a-z]+)(\??)$/

/**
 * Parse a field value string to extract type, operator, reference, and prompt.
 * Uses the centralized parser for operator detection.
 *
 * Examples:
 * - 'string' -> { type: 'string', required: true }
 * - 'string?' -> { type: 'string', required: false }
 * - '->User' -> { type: 'reference', operator: '->', reference: 'User', required: true }
 * - 'What is the idea? <-Idea' -> { type: 'reference', operator: '<-', reference: 'Idea', prompt: 'What is the idea?' }
 * - '->Node?' -> { type: 'reference', operator: '->', reference: 'Node', required: false }
 */
function parseFieldValue(value: string, fieldName?: string, typeName?: string): Partial<LegacyParsedField> {
  // Use centralized parser for operator detection
  const parsed = defaultParser.parseReference(value)
  if (parsed) {
    return {
      type: 'reference',
      operator: parsed.operator as CascadeOperator,
      reference: parsed.target,
      required: !parsed.isOptional,
      ...(parsed.prompt && { prompt: parsed.prompt }),
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

  // Check if it looks like a reference with invalid format
  if (value.includes('->') || value.includes('<-') || value.includes('~>') || value.includes('<~')) {
    throw new CascadeSchemaError({
      field: fieldName,
      typeName,
      value,
      reason: 'Invalid reference format',
      hint: 'Reference format should be: [prompt] operator Target[?]. Example: "->User" or "What user? ->User?"',
    })
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
function parseField(name: string, value: unknown, typeName?: string): LegacyParsedField {
  const field: LegacyParsedField = {
    name,
    type: 'unknown',
    required: true,
  }

  if (typeof value === 'string') {
    // Simple string field definition
    const parsed = parseFieldValue(value, name, typeName)
    Object.assign(field, parsed)
  } else if (Array.isArray(value)) {
    // Array field
    field.isArray = true

    if (value.length > 0) {
      const firstElement = value[0]

      if (typeof firstElement === 'string') {
        // Array of primitives or references: ['string'] or ['->Type']
        const parsed = parseFieldValue(firstElement, name, typeName)
        Object.assign(field, parsed)

        // Check for array constraints in second element: ['->Type', { minItems: 2, maxItems: 5 }]
        if (value.length > 1) {
          const constraints = value[1]
          if (typeof constraints === 'object' && constraints !== null) {
            const constraintsObj = constraints as Record<string, unknown>
            if (constraintsObj.minItems !== undefined) {
              (field as unknown as Record<string, unknown>).minItems = constraintsObj.minItems
            }
            if (constraintsObj.maxItems !== undefined) {
              (field as unknown as Record<string, unknown>).maxItems = constraintsObj.maxItems
            }
          }
        }
      } else if (typeof firstElement === 'object' && firstElement !== null) {
        // Array of nested objects: [{ product: '->Product', quantity: 'number' }]
        field.isNested = true
        field.nestedFields = parseFieldsFromObject(firstElement as Record<string, unknown>, typeName)
        field.type = 'object'
      }
    }
  } else if (typeof value === 'object' && value !== null) {
    // Nested object field
    field.isNested = true
    field.nestedFields = parseFieldsFromObject(value as Record<string, unknown>, typeName)
    field.type = 'object'
  }

  return field
}

/**
 * Parse fields from an object definition
 */
function parseFieldsFromObject(obj: Record<string, unknown>, typeName?: string): LegacyParsedField[] {
  const fields: LegacyParsedField[] = []

  for (const [key, value] of Object.entries(obj)) {
    // Skip $ directives
    if (isDirective(key)) continue

    fields.push(parseField(key, value, typeName))
  }

  return fields
}

/**
 * Parse a type definition
 */
function parseType(name: string, definition: Record<string, unknown>): LegacyParsedType {
  return {
    name,
    fields: parseFieldsFromObject(definition, name),
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
 * Options for schema parsing
 */
export interface ParseSchemaOptions {
  /** Validate that referenced types exist */
  validateReferences?: boolean
  /** Detect circular references at parse time */
  detectCircularReferences?: boolean
}

/**
 * Parse a schema definition into a structured LegacyParsedSchema
 *
 * @param def - The schema definition to parse
 * @param options - Optional parsing options
 * @returns Parsed schema with type information and helper methods
 * @throws CascadeSchemaError if validation fails (when options are enabled)
 */
export function parseSchema(def: SchemaDefinition, options?: ParseSchemaOptions): LegacyParsedSchema {
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

  // Validate references if requested
  if (options?.validateReferences) {
    const definedTypes = new Set(types.map(t => t.name))
    for (const type of types) {
      for (const field of type.fields) {
        if (field.reference && !definedTypes.has(field.reference) && !PRIMITIVE_TYPES.has(field.reference.toLowerCase())) {
          throw new CascadeSchemaError({
            typeName: type.name,
            field: field.name,
            value: field.reference,
            reason: `Referenced type '${field.reference}' is not defined in schema`,
            hint: `Define the '${field.reference}' type in your schema, or use a primitive type (string, number, boolean, etc.)`,
          })
        }
      }
    }
  }

  // Detect circular references if requested
  if (options?.detectCircularReferences) {
    const rawSchema: Record<string, Record<string, unknown>> = {}
    for (const type of types) {
      const fields: Record<string, unknown> = {}
      for (const field of type.fields) {
        if (field.operator && field.reference) {
          fields[field.name] = `${field.operator}${field.reference}${field.required ? '' : '?'}`
        } else {
          fields[field.name] = field.type
        }
      }
      rawSchema[type.name] = fields
    }

    const circularError = defaultParser.detectCircularReferences(rawSchema)
    if (circularError) {
      throw circularError
    }
  }

  return {
    metadata,
    types,
    getType: (name: string) => typeMap.get(name),
    hasType: (name: string) => typeMap.has(name),
    getFieldsForType: (name: string) => typeMap.get(name)?.fields ?? [],
  }
}
