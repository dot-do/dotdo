/**
 * Field Type Parsing for Cascade Schema Generation
 *
 * Converts various field value formats into normalized ParsedField objects.
 * Supports: string prompts, array prompts, nested objects, computed fields,
 * boolean defaults, and number defaults.
 */

import type { ParsedField, FieldValue } from './field-types'

/**
 * Parse a string field value into a ParsedField.
 * String values are interpreted as prompts/descriptions.
 */
function parseStringField(value: string): ParsedField {
  return {
    type: 'string',
    description: value.trim(),
  }
}

/**
 * Parse an array field value into a ParsedField.
 * Arrays can contain string prompts or nested object schemas.
 */
function parseArrayField(value: unknown[]): ParsedField {
  // Empty array - generic string array
  if (value.length === 0) {
    return {
      type: 'array',
      items: 'string',
    }
  }

  // Check if first element is an object (nested schema)
  const first = value[0]
  if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
    return {
      type: 'array',
      items: parseObjectField(first as Record<string, unknown>),
    }
  }

  // All string elements - combine as description
  if (value.every((v) => typeof v === 'string')) {
    return {
      type: 'array',
      items: 'string',
      description: (value as string[]).join(' '),
    }
  }

  // Default: string array with first element as description
  return {
    type: 'array',
    items: 'string',
    description: String(value[0]),
  }
}

/**
 * Parse an object field value into a ParsedField.
 * Objects represent nested structures with named properties.
 */
function parseObjectField(value: Record<string, unknown>): ParsedField {
  const properties: Record<string, ParsedField> = {}

  for (const [key, fieldValue] of Object.entries(value)) {
    properties[key] = parseFieldType(fieldValue)
  }

  return {
    type: 'object',
    properties,
  }
}

/**
 * Parse a computed field (function) into a ParsedField.
 * Serializes the function source for inspection/reconstruction.
 */
function parseComputedField(value: (...args: unknown[]) => unknown): ParsedField {
  return {
    type: 'computed',
    source: value.toString(),
  }
}

/**
 * Parse any field value into a normalized ParsedField object.
 *
 * @param value - The field value to parse (string, number, boolean, array, object, or function)
 * @returns A normalized ParsedField representation
 *
 * @example
 * parseFieldType('What is the concept?')
 * // => { type: 'string', description: 'What is the concept?' }
 *
 * @example
 * parseFieldType(['List the problems'])
 * // => { type: 'array', items: 'string', description: 'List the problems' }
 *
 * @example
 * parseFieldType({ wants: 'What?', fears: 'Why?' })
 * // => { type: 'object', properties: { wants: {...}, fears: {...} } }
 *
 * @example
 * parseFieldType((e) => e.first + e.last)
 * // => { type: 'computed', source: '(e) => e.first + e.last' }
 */
export function parseFieldType(value: FieldValue): ParsedField {
  // Handle null/undefined gracefully
  if (value == null) {
    return { type: 'string', description: '' }
  }

  // String fields - most common case, check first
  if (typeof value === 'string') {
    return parseStringField(value)
  }

  // Primitive types with defaults
  if (typeof value === 'boolean') {
    return { type: 'boolean', default: value }
  }

  if (typeof value === 'number') {
    return { type: 'number', default: value }
  }

  // Function/computed fields
  if (typeof value === 'function') {
    return parseComputedField(value as (...args: unknown[]) => unknown)
  }

  // Array fields
  if (Array.isArray(value)) {
    return parseArrayField(value)
  }

  // Object fields (excluding special objects like Date)
  if (typeof value === 'object') {
    if (value instanceof Date) {
      return { type: 'string', description: '' }
    }
    return parseObjectField(value as Record<string, unknown>)
  }

  // Fallback for edge cases (symbols, etc.)
  return { type: 'string', description: '' }
}
