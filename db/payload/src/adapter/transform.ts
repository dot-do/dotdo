/**
 * Field Transformation Functions
 *
 * Bidirectional transformations between Payload CMS documents and dotdo Things.
 * Optimized for type safety and performance with cached schema lookups.
 *
 * @module @dotdo/payload/adapter/transform
 */

import type { ThingData } from '../../../../types/Thing'
import type { PayloadField, PayloadFieldType } from './types'
import { slugToNounName } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context required for field transformations
 */
export interface TransformContext {
  /** The collection slug (e.g., 'posts') */
  collection: string
  /** The dotdo namespace URL (e.g., 'https://example.do') */
  namespace: string
  /** The Payload field definitions for this collection */
  fields: PayloadField[]
}

/**
 * Discriminated union for text-like field types
 */
export type TextLikeField = PayloadField & {
  type: 'text' | 'textarea' | 'email' | 'code' | 'select' | 'radio'
}

/**
 * Discriminated union for relationship field types
 */
export type RelationshipField = PayloadField & {
  type: 'relationship' | 'upload'
  relationTo?: string | string[]
  hasMany?: boolean
}

/**
 * Discriminated union for array field types
 */
export type ArrayField = PayloadField & {
  type: 'array'
  fields?: PayloadField[]
}

/**
 * Discriminated union for group field types
 */
export type GroupField = PayloadField & {
  type: 'group'
  fields?: PayloadField[]
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a field is a text-like field
 * @param field - The field to check
 * @returns True if the field is a text-like type
 */
export function isTextLikeField(field: PayloadField): field is TextLikeField {
  return (
    field.type === 'text' ||
    field.type === 'textarea' ||
    field.type === 'email' ||
    field.type === 'code' ||
    field.type === 'select' ||
    field.type === 'radio'
  )
}

/**
 * Type guard to check if a field is a relationship or upload field
 * @param field - The field to check
 * @returns True if the field is a relationship or upload type
 */
export function isRelationshipField(field: PayloadField): field is RelationshipField {
  return field.type === 'relationship' || field.type === 'upload'
}

/**
 * Type guard to check if a field is an array field
 * @param field - The field to check
 * @returns True if the field is an array type
 */
export function isArrayField(field: PayloadField): field is ArrayField {
  return field.type === 'array'
}

/**
 * Type guard to check if a field is a group field
 * @param field - The field to check
 * @returns True if the field is a group type
 */
export function isGroupField(field: PayloadField): field is GroupField {
  return field.type === 'group'
}

/**
 * Type guard to check if a field is a passthrough type (no transformation needed)
 * @param field - The field to check
 * @returns True if the field value should pass through unchanged
 */
export function isPassthroughField(field: PayloadField): boolean {
  return (
    isTextLikeField(field) ||
    field.type === 'number' ||
    field.type === 'checkbox' ||
    field.type === 'point' ||
    field.type === 'json' ||
    field.type === 'blocks' ||
    field.type === 'group'
  )
}

// ============================================================================
// SCHEMA CACHING
// ============================================================================

/**
 * Cache for field maps to avoid rebuilding on repeated transformations.
 * Key format: `${namespace}/${collection}` for collection-scoped caching.
 */
const fieldMapCache = new WeakMap<PayloadField[], Map<string, PayloadField>>()

/**
 * System fields that should be excluded from data transformation
 */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set(['id', 'createdAt', 'updatedAt'])

/**
 * Field types that pass through without transformation to Thing format
 */
const PASSTHROUGH_TO_THING_TYPES: ReadonlySet<PayloadFieldType> = new Set<PayloadFieldType>([
  'text',
  'textarea',
  'email',
  'code',
  'select',
  'radio',
  'number',
  'checkbox',
  'point',
  'json',
  'blocks',
  'group',
])

/**
 * Field types that pass through without transformation to Payload format
 */
const PASSTHROUGH_TO_PAYLOAD_TYPES: ReadonlySet<PayloadFieldType> = new Set<PayloadFieldType>([
  'text',
  'textarea',
  'email',
  'code',
  'select',
  'radio',
  'number',
  'checkbox',
  'point',
  'json',
  'blocks',
  'group',
  'relationship',
  'upload',
])

/**
 * Build or retrieve cached field map for efficient lookups
 *
 * @param fields - The Payload field definitions
 * @returns A Map of field names to field definitions
 */
function getFieldMap(fields: PayloadField[]): Map<string, PayloadField> {
  let map = fieldMapCache.get(fields)
  if (!map) {
    map = new Map<string, PayloadField>()
    for (const field of fields) {
      map.set(field.name, field)
    }
    fieldMapCache.set(fields, map)
  }
  return map
}

// ============================================================================
// PAYLOAD TO THING TRANSFORMATION
// ============================================================================

/**
 * Transform a Payload document to dotdo Thing data
 *
 * Converts field values from Payload CMS format to dotdo Thing format:
 * - Dates are converted to ISO strings
 * - Rich text is stringified to JSON
 * - Simple arrays are flattened
 * - Relationships extract IDs from populated documents
 *
 * @typeParam T - The input document type
 * @param doc - The Payload document to transform
 * @param collection - The collection slug (e.g., 'posts')
 * @param namespace - The dotdo namespace URL (e.g., 'https://example.do')
 * @param fields - The Payload field definitions for this collection
 * @returns Partial ThingData ready for storage
 *
 * @example
 * ```typescript
 * const thing = transformPayloadToThing(
 *   { id: '123', title: 'Hello', views: 42 },
 *   'posts',
 *   'https://example.do',
 *   postFields
 * )
 * // Returns: { $id: 'https://example.do/posts/123', $type: 'https://example.do/Post', ... }
 * ```
 */
export function transformPayloadToThing<T extends Record<string, unknown>>(
  doc: T,
  collection: string,
  namespace: string,
  fields: PayloadField[]
): Partial<ThingData> {
  const id = doc.id as string
  const nounName = slugToNounName(collection)

  // Get cached field lookup map
  const fieldMap = getFieldMap(fields)

  // Transform the data fields
  const data = transformFieldsToThing(doc, fieldMap)

  // Extract name from title or name field
  const name = (doc.title as string) || (doc.name as string) || undefined

  return {
    $id: `${namespace}/${collection}/${id}`,
    $type: `${namespace}/${nounName}`,
    name,
    data,
    createdAt: parseDate(doc.createdAt),
    updatedAt: parseDate(doc.updatedAt),
  }
}

/**
 * Transform Thing data back to a Payload document
 *
 * Converts field values from dotdo Thing format back to Payload CMS format:
 * - ISO date strings are parsed to Date objects
 * - JSON strings are parsed back to rich text objects
 * - Flattened arrays are expanded to Payload array format
 *
 * @typeParam T - The input Thing data type
 * @param thing - The Thing data to transform
 * @param fields - The Payload field definitions for this collection
 * @returns A Payload-compatible document
 *
 * @example
 * ```typescript
 * const doc = transformThingToPayload(
 *   { $id: 'https://example.do/posts/123', data: { title: 'Hello' } },
 *   postFields
 * )
 * // Returns: { id: '123', title: 'Hello', ... }
 * ```
 */
export function transformThingToPayload<T extends Partial<ThingData>>(
  thing: T,
  fields: PayloadField[]
): Record<string, unknown> {
  // Extract ID from $id
  const id = thing.$id?.split('/').pop()

  // Get cached field lookup map
  const fieldMap = getFieldMap(fields)

  // Transform the data fields back to Payload format
  const transformedData = transformFieldsToPayload(thing.data || {}, fieldMap)

  return {
    id,
    ...transformedData,
    createdAt: thing.createdAt,
    updatedAt: thing.updatedAt,
  }
}

// ============================================================================
// FIELD TRANSFORMATION HELPERS
// ============================================================================

/**
 * Transform Payload document fields to Thing data format
 *
 * @param doc - The Payload document
 * @param fieldMap - Map of field names to field definitions
 * @returns Transformed data object
 */
function transformFieldsToThing(
  doc: Record<string, unknown>,
  fieldMap: Map<string, PayloadField>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const key in doc) {
    // Skip system fields using Set lookup (O(1))
    if (SYSTEM_FIELDS.has(key)) {
      continue
    }

    const value = doc[key]
    const field = fieldMap.get(key)

    if (field) {
      result[key] = transformFieldValueToThing(value, field)
    } else {
      // Preserve unknown fields as-is
      result[key] = value
    }
  }

  return result
}

/**
 * Transform a single field value from Payload to Thing format
 *
 * @param value - The field value to transform
 * @param field - The field definition
 * @returns The transformed value
 */
function transformFieldValueToThing(value: unknown, field: PayloadField): unknown {
  // Fast path: null/undefined pass through
  if (value == null) {
    return value
  }

  // Fast path: passthrough types (most common case)
  if (PASSTHROUGH_TO_THING_TYPES.has(field.type)) {
    // Special handling for date (still in passthrough set for other logic)
    if (field.type === 'date' && value instanceof Date) {
      return value.toISOString()
    }
    return value
  }

  // Handle specific transformation types
  switch (field.type) {
    case 'date':
      // Convert Date to ISO string
      return value instanceof Date ? value.toISOString() : value

    case 'richText':
      // Stringify rich text to JSON
      return typeof value === 'object' ? JSON.stringify(value) : value

    case 'array':
      return transformArrayFieldToThing(value, field as ArrayField)

    case 'relationship':
    case 'upload':
      return transformRelationshipToThing(value, field as RelationshipField)

    default:
      return value
  }
}

/**
 * Transform array field from Payload to Thing format
 *
 * Payload arrays have structure like: [{ tag: 'news' }, { tag: 'featured' }]
 * For simple arrays with a single text field, we flatten to: ['news', 'featured']
 *
 * @param value - The array value to transform
 * @param field - The array field definition
 * @returns The transformed array
 */
function transformArrayFieldToThing(value: unknown, field: ArrayField): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  // Check if this is a simple array with a single text field
  const subFields = field.fields
  if (subFields && subFields.length === 1 && subFields[0].type === 'text') {
    const fieldName = subFields[0].name
    return value.map((item) => {
      if (typeof item === 'object' && item !== null && fieldName in item) {
        return (item as Record<string, unknown>)[fieldName]
      }
      return item
    })
  }

  // For complex arrays, keep the full structure
  return value
}

/**
 * Transform relationship/upload field from Payload to Thing format
 *
 * Extracts IDs from relationship values, which can be:
 * - Simple ID strings
 * - Populated document objects with { id: ... }
 * - Polymorphic values with { relationTo, value }
 *
 * @param value - The relationship value to transform
 * @param field - The relationship field definition
 * @returns The extracted ID(s)
 */
function transformRelationshipToThing(value: unknown, field: RelationshipField): unknown {
  if (value == null) {
    return value
  }

  // Handle hasMany relationships (array of values)
  if (field.hasMany && Array.isArray(value)) {
    return value.map((item) => extractRelationshipId(item))
  }

  // Handle polymorphic relationships (array of relationTo)
  if (Array.isArray(field.relationTo) && typeof value === 'object' && value !== null) {
    const polyValue = value as { relationTo?: string; value?: unknown }
    if ('relationTo' in polyValue && 'value' in polyValue) {
      return extractRelationshipId(polyValue.value)
    }
  }

  return extractRelationshipId(value)
}

/**
 * Extract the ID from a relationship value
 *
 * @param value - The relationship value (ID string or populated doc)
 * @returns The extracted ID or original value
 */
function extractRelationshipId(value: unknown): unknown {
  // Fast path: already a string ID
  if (typeof value === 'string') {
    return value
  }

  // Extract from populated document
  if (typeof value === 'object' && value !== null && 'id' in value) {
    return (value as { id: unknown }).id
  }

  return value
}

// ============================================================================
// THING TO PAYLOAD TRANSFORMATION
// ============================================================================

/**
 * Transform Thing data fields back to Payload format
 *
 * @param data - The Thing data object
 * @param fieldMap - Map of field names to field definitions
 * @returns Transformed Payload document fields
 */
function transformFieldsToPayload(
  data: Record<string, unknown>,
  fieldMap: Map<string, PayloadField>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const key in data) {
    const value = data[key]
    const field = fieldMap.get(key)

    if (field) {
      result[key] = transformFieldValueToPayload(value, field)
    } else {
      // Preserve unknown fields as-is
      result[key] = value
    }
  }

  return result
}

/**
 * Transform a single field value from Thing to Payload format
 *
 * @param value - The field value to transform
 * @param field - The field definition
 * @returns The transformed value
 */
function transformFieldValueToPayload(value: unknown, field: PayloadField): unknown {
  // Fast path: null/undefined pass through
  if (value == null) {
    return value
  }

  // Fast path: passthrough types (most common case)
  if (PASSTHROUGH_TO_PAYLOAD_TYPES.has(field.type)) {
    return value
  }

  // Handle specific transformation types
  switch (field.type) {
    case 'date':
      // Parse ISO string back to Date
      return typeof value === 'string' ? new Date(value) : value

    case 'richText':
      // Parse JSON string back to object
      if (typeof value === 'string') {
        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      }
      return value

    case 'array':
      return transformArrayFieldToPayload(value, field as ArrayField)

    default:
      return value
  }
}

/**
 * Transform array field from Thing to Payload format
 *
 * Expands flat arrays like ['news', 'featured']
 * back to Payload format: [{ tag: 'news' }, { tag: 'featured' }]
 *
 * @param value - The array value to transform
 * @param field - The array field definition
 * @returns The expanded array in Payload format
 */
function transformArrayFieldToPayload(value: unknown, field: ArrayField): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  // Check if this is a simple array with a single text field
  const subFields = field.fields
  if (subFields && subFields.length === 1 && subFields[0].type === 'text') {
    const fieldName = subFields[0].name
    // Check if already in expanded form
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      return value
    }
    // Expand flat array to Payload format
    return value.map((item) => ({ [fieldName]: item }))
  }

  // For complex arrays, keep the full structure
  return value
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Parse a date value to a Date object
 *
 * @param value - The value to parse (Date, string, or other)
 * @returns A Date object or undefined if not parseable
 */
function parseDate(value: unknown): Date | undefined {
  if (!value) {
    return undefined
  }

  if (value instanceof Date) {
    return value
  }

  if (typeof value === 'string') {
    return new Date(value)
  }

  return undefined
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Clear the field map cache
 *
 * Useful for testing or when field definitions change dynamically.
 * Note: Since we use WeakMap, entries are automatically garbage collected
 * when the fields array is no longer referenced.
 */
export function clearFieldMapCache(): void {
  // WeakMap doesn't support clearing, but entries are GC'd automatically
  // This function is provided for API completeness and documentation
}

/**
 * Get statistics about cached field maps
 *
 * Note: WeakMap doesn't provide size/iteration, so this is for documentation
 * @returns Cache statistics (currently always returns 'unknown' for WeakMap)
 */
export function getFieldMapCacheStats(): { type: 'WeakMap'; note: string } {
  return {
    type: 'WeakMap',
    note: 'WeakMap cache automatically garbage collects unused entries',
  }
}
