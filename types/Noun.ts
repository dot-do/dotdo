/**
 * Noun - Type registry for defining domain entities
 *
 * Nouns define the schema and metadata for domain entities (Things).
 * They provide a way to register types with field definitions,
 * relationships, and optional DO class bindings.
 *
 * @module types/Noun
 *
 * @example
 * ```typescript
 * import type { NounData, Noun, ParsedField } from 'dotdo/types'
 * import { parseField } from 'dotdo/types'
 *
 * // Define a Startup noun
 * const startupNoun: NounData = {
 *   noun: 'Startup',
 *   plural: 'Startups',
 *   description: 'A company in the portfolio',
 *   schema: {
 *     name: 'string',
 *     stage: 'string',
 *     icp: '->ICP',  // Relationship to ICP type
 *     tags: '[->Tag]', // Array relationship to Tag type
 *   }
 * }
 *
 * // Parse a field definition
 * const field = parseField('icp', '->ICP')
 * // { name: 'icp', type: 'ICP', isRelation: true, operator: '->', ... }
 * ```
 */

// ============================================================================
// NOUN - Type registry entry
// ============================================================================

/**
 * NounData - Base data structure for noun definitions
 *
 * Defines the metadata and schema for a domain entity type.
 * Used to register types in the noun registry.
 *
 * @see {@link Noun} for the full noun instance with methods
 * @see {@link NounSchema} for field definitions
 */
export interface NounData {
  /** The noun name in PascalCase (e.g., 'Startup', 'Customer') */
  noun: string
  /** Pluralized form of the noun (e.g., 'Startups', 'Customers') */
  plural?: string
  /** Human-readable description of what this noun represents */
  description?: string
  /** Field definitions using the schema DSL */
  schema?: NounSchema
  /** Cloudflare binding name if this noun is a Durable Object subclass */
  doClass?: string
}

/**
 * NounSchema - Field definitions for a noun using the schema DSL
 *
 * Fields can be defined as:
 * - Simple string types: 'string', 'number', 'boolean', 'date'
 * - Relationship operators: '->Type', '~>Type', '<-Type', '<~Type'
 * - Arrays: 'string[]', '[->Tag]'
 * - Optional: 'string?', '->Category?'
 *
 * @example
 * ```typescript
 * const schema: NounSchema = {
 *   name: 'string',
 *   age: 'number',
 *   category: '->Category',      // Exact match relationship
 *   tags: '[->Tag]',             // Array of relationships
 *   related: '~>Startup',        // Fuzzy match relationship
 *   parent: '<-Organization',    // Backward relationship
 * }
 * ```
 */
export interface NounSchema {
  /** Field name mapped to type definition string or FieldDefinition object */
  [field: string]: string | FieldDefinition
}

/**
 * FieldDefinition - Detailed field configuration
 *
 * Used for advanced field configuration when the string DSL is insufficient.
 * Supports relationship operators, AI prompts, and indexing options.
 *
 * @example
 * ```typescript
 * const field: FieldDefinition = {
 *   type: 'ICP',
 *   required: true,
 *   operator: '~>',
 *   targetType: 'ICP',
 *   prompt: 'What is the ideal customer profile?',
 *   threshold: 0.8,
 *   index: true
 * }
 * ```
 */
export interface FieldDefinition {
  /** The data type ('string', 'number', 'boolean', 'date', or a noun name for relationships) */
  type: string
  /** Human-readable description of the field */
  description?: string
  /** Whether the field is required (default: false) */
  required?: boolean
  /** Default value for the field */
  default?: unknown

  /**
   * Relationship operator for linking to other types:
   * - '->' Forward exact match
   * - '~>' Forward fuzzy match
   * - '<-' Backward exact match
   * - '<~' Backward fuzzy match
   */
  operator?: '->' | '~>' | '<-' | '<~'
  /** Target type name for relationships */
  targetType?: string
  /** AI generation prompt for fuzzy matching */
  prompt?: string
  /** Fuzzy match threshold (0-1), higher = stricter matching */
  threshold?: number

  /**
   * Whether to create a SQLite expression index on json_extract(data, '$.field')
   * Use for fields frequently used in WHERE clauses to improve query performance
   */
  index?: boolean
}

// ============================================================================
// NOUN INSTANCE (from registry)
// ============================================================================

/**
 * Noun - Full noun instance with methods
 *
 * Extends NounData with methods for accessing Things of this type
 * and parsing the schema into structured field definitions.
 *
 * @see {@link NounData} for the base data structure
 */
export interface Noun extends NounData {
  /**
   * Get all Things of this noun type
   * @returns A Things collection filtered to this type
   */
  things: () => import('./Things').Things

  /**
   * Get the schema as parsed field definitions
   * @returns Array of ParsedField objects
   */
  fields: () => ParsedField[]
}

/**
 * ParsedField - Parsed field definition with normalized properties
 *
 * Represents a field definition after parsing from the string DSL
 * or FieldDefinition object. All relationship and type information
 * is normalized into consistent properties.
 *
 * @see {@link parseField} for creating ParsedField from definitions
 */
export interface ParsedField {
  /** Field name */
  name: string
  /** Resolved type name */
  type: string
  /** Whether this is an array field */
  isArray: boolean
  /** Whether this field is optional */
  isOptional: boolean
  /** Whether this field is a relationship to another type */
  isRelation: boolean
  /** Target type name for relationships */
  relatedType?: string
  /** Relationship operator used */
  operator?: '->' | '~>' | '<-' | '<~'
  /** Direction of the relationship */
  direction?: 'forward' | 'backward'
  /** Match mode for fuzzy vs exact matching */
  matchMode?: 'exact' | 'fuzzy'
  /** AI prompt for fuzzy matching */
  prompt?: string
  /** Fuzzy match threshold (0-1) */
  threshold?: number
}

// ============================================================================
// HELPER: Parse field definition
// ============================================================================

/**
 * Parse a field definition into a normalized ParsedField structure
 *
 * Handles both string DSL and FieldDefinition objects.
 * Extracts relationship operators, types, prompts, and other metadata.
 *
 * @param name - The field name
 * @param definition - The field definition (string DSL or FieldDefinition object)
 * @returns A ParsedField with normalized properties
 *
 * @example
 * ```typescript
 * // Parse a simple type
 * parseField('name', 'string')
 * // { name: 'name', type: 'string', isRelation: false, ... }
 *
 * // Parse a relationship
 * parseField('icp', '->ICP')
 * // { name: 'icp', type: 'ICP', isRelation: true, operator: '->', direction: 'forward', ... }
 *
 * // Parse with AI prompt
 * parseField('category', 'What category? ~>Category')
 * // { name: 'category', type: 'Category', isRelation: true, prompt: 'What category?', matchMode: 'fuzzy', ... }
 *
 * // Parse an array relationship
 * parseField('tags', '[->Tag]')
 * // { name: 'tags', type: 'Tag', isArray: true, isRelation: true, ... }
 * ```
 */
export function parseField(name: string, definition: string | FieldDefinition): ParsedField {
  if (typeof definition === 'object') {
    return {
      name,
      type: definition.type,
      isArray: definition.type.endsWith('[]'),
      isOptional: !definition.required,
      isRelation: !!definition.operator,
      relatedType: definition.targetType,
      operator: definition.operator,
      direction: definition.operator?.startsWith('<') ? 'backward' : 'forward',
      matchMode: definition.operator?.includes('~') ? 'fuzzy' : 'exact',
      prompt: definition.prompt,
      threshold: definition.threshold,
    }
  }

  // Parse string definition: 'What is the idea? ->Idea'
  const operators = ['~>', '<~', '->', '<-'] as const

  for (const op of operators) {
    const opIndex = definition.indexOf(op)
    if (opIndex !== -1) {
      const prompt = definition.slice(0, opIndex).trim() || undefined
      let targetType = definition.slice(opIndex + op.length).trim()

      // Handle array syntax: ['->Tag']
      const isArray = targetType.startsWith('[') && targetType.endsWith(']')
      if (isArray) {
        targetType = targetType.slice(1, -1)
      }

      // Handle optional: '->Category?'
      const isOptional = targetType.endsWith('?')
      if (isOptional) {
        targetType = targetType.slice(0, -1)
      }

      return {
        name,
        type: targetType,
        isArray,
        isOptional,
        isRelation: true,
        relatedType: targetType,
        operator: op,
        direction: op.startsWith('<') ? 'backward' : 'forward',
        matchMode: op.includes('~') ? 'fuzzy' : 'exact',
        prompt,
      }
    }
  }

  // Simple field type
  const isArray = definition.endsWith('[]')
  const isOptional = definition.endsWith('?')
  const type = definition.replace(/[\[\]?]/g, '')

  return {
    name,
    type,
    isArray,
    isOptional,
    isRelation: false,
  }
}
