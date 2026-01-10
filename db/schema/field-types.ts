/**
 * Field Type Definitions for Cascade Schema Generation
 *
 * These types define the normalized field representations used internally
 * by the cascade schema system after parsing user-defined field values.
 */

/**
 * Parsed field representation - normalized format for all field types.
 * This is the internal representation used by the cascade schema system.
 */
export interface ParsedField {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'computed'
  description?: string
  default?: unknown
  items?: string | ParsedField
  properties?: Record<string, ParsedField>
  source?: string
}

/**
 * String field - represents text content, often with a prompt description.
 */
export interface StringField {
  type: 'string'
  description?: string
}

/**
 * Number field - represents numeric values with optional default.
 */
export interface NumberField {
  type: 'number'
  default?: number
}

/**
 * Boolean field - represents true/false values with optional default.
 */
export interface BooleanField {
  type: 'boolean'
  default?: boolean
}

/**
 * Array field - represents lists of items with optional item schema.
 */
export interface ArrayField {
  type: 'array'
  items: string | ParsedField
  description?: string
}

/**
 * Object field - represents nested structures with named properties.
 */
export interface ObjectField {
  type: 'object'
  properties: Record<string, ParsedField>
}

/**
 * Computed field - represents derived values from functions.
 */
export interface ComputedField {
  type: 'computed'
  source: string
}

/**
 * JSONPath field - represents references to other fields via JSONPath expressions.
 */
export interface JSONPathField {
  type: 'string'
  source: string
}

/**
 * Union type of all possible field value inputs.
 * This represents what users can provide in their schema definitions.
 */
export type FieldValue =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>
  | ((...args: unknown[]) => unknown)
  | null
  | undefined
