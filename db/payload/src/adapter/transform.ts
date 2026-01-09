/**
 * Field Transformation Functions
 *
 * Bidirectional transformations between Payload CMS documents and dotdo Things.
 *
 * @module @dotdo/payload/adapter/transform
 */

import type { ThingData } from '../../../../types/Thing'
import type { PayloadField } from './types'
import { slugToNounName } from './types'

// ============================================================================
// TYPES
// ============================================================================

export interface TransformContext {
  collection: string
  namespace: string
  fields: PayloadField[]
}

// ============================================================================
// PAYLOAD TO THING TRANSFORMATION
// ============================================================================

/**
 * Transform a Payload document to dotdo Thing data
 *
 * @param doc - The Payload document to transform
 * @param collection - The collection slug (e.g., 'posts')
 * @param namespace - The dotdo namespace URL (e.g., 'https://example.do')
 * @param fields - The Payload field definitions for this collection
 * @returns Partial ThingData ready for storage
 */
export function transformPayloadToThing(
  doc: Record<string, unknown>,
  collection: string,
  namespace: string,
  fields: PayloadField[]
): Partial<ThingData> {
  const id = doc.id as string
  const nounName = slugToNounName(collection)

  // Build field lookup for efficient access
  const fieldMap = buildFieldMap(fields)

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
 * @param thing - The Thing data to transform
 * @param fields - The Payload field definitions for this collection
 * @returns A Payload-compatible document
 */
export function transformThingToPayload(
  thing: Partial<ThingData>,
  fields: PayloadField[]
): Record<string, unknown> {
  // Extract ID from $id
  const id = thing.$id?.split('/').pop()

  // Build field lookup for efficient access
  const fieldMap = buildFieldMap(fields)

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
 * Build a map of field names to field definitions for efficient lookup
 */
function buildFieldMap(fields: PayloadField[]): Map<string, PayloadField> {
  const map = new Map<string, PayloadField>()
  for (const field of fields) {
    map.set(field.name, field)
  }
  return map
}

/**
 * Transform Payload document fields to Thing data format
 */
function transformFieldsToThing(
  doc: Record<string, unknown>,
  fieldMap: Map<string, PayloadField>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(doc)) {
    // Skip system fields
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt') {
      continue
    }

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
 */
function transformFieldValueToThing(
  value: unknown,
  field: PayloadField
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'code':
    case 'select':
    case 'radio':
      return value

    case 'number':
    case 'checkbox':
      return value

    case 'date':
      // Convert Date to ISO string
      if (value instanceof Date) {
        return value.toISOString()
      }
      return value

    case 'richText':
      // Stringify rich text to JSON
      if (typeof value === 'object') {
        return JSON.stringify(value)
      }
      return value

    case 'json':
      // Keep JSON as-is (object form)
      return value

    case 'point':
      // Keep point as-is [lng, lat]
      return value

    case 'array':
      return transformArrayFieldToThing(value, field)

    case 'blocks':
      // Keep blocks as-is with blockType preserved
      return value

    case 'group':
      // Keep group as nested object
      return value

    case 'relationship':
    case 'upload':
      return transformRelationshipToThing(value, field)

    default:
      return value
  }
}

/**
 * Transform array field from Payload to Thing format
 *
 * Payload arrays have structure like: [{ tag: 'news' }, { tag: 'featured' }]
 * We flatten to: ['news', 'featured'] when the array has a single text field
 */
function transformArrayFieldToThing(
  value: unknown,
  field: PayloadField
): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  // Check if this is a simple array with a single text field
  const subFields = field.fields || []
  if (subFields.length === 1 && subFields[0].type === 'text') {
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
 */
function transformRelationshipToThing(
  value: unknown,
  field: PayloadField
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  // Handle hasMany relationships
  if (field.hasMany && Array.isArray(value)) {
    return value.map((item) => extractRelationshipId(item, field))
  }

  // Handle polymorphic relationships (array of relationTo)
  if (Array.isArray(field.relationTo) && typeof value === 'object' && value !== null) {
    const polyValue = value as { relationTo?: string; value?: unknown }
    if ('relationTo' in polyValue && 'value' in polyValue) {
      return extractRelationshipId(polyValue.value, field)
    }
  }

  return extractRelationshipId(value, field)
}

/**
 * Extract the ID from a relationship value (can be ID string or populated doc)
 */
function extractRelationshipId(value: unknown, _field: PayloadField): unknown {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'object' && value !== null) {
    const doc = value as Record<string, unknown>
    if ('id' in doc) {
      return doc.id
    }
  }

  return value
}

// ============================================================================
// THING TO PAYLOAD TRANSFORMATION
// ============================================================================

/**
 * Transform Thing data fields back to Payload format
 */
function transformFieldsToPayload(
  data: Record<string, unknown>,
  fieldMap: Map<string, PayloadField>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
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
 */
function transformFieldValueToPayload(
  value: unknown,
  field: PayloadField
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'code':
    case 'select':
    case 'radio':
    case 'number':
    case 'checkbox':
    case 'point':
    case 'json':
      return value

    case 'date':
      // Parse ISO string back to Date
      if (typeof value === 'string') {
        return new Date(value)
      }
      return value

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
      return transformArrayFieldToPayload(value, field)

    case 'blocks':
      // Keep blocks as-is
      return value

    case 'group':
      // Keep group as nested object
      return value

    case 'relationship':
    case 'upload':
      // IDs are kept as-is
      return value

    default:
      return value
  }
}

/**
 * Transform array field from Thing to Payload format
 *
 * We need to expand flat arrays like ['news', 'featured']
 * back to Payload format: [{ tag: 'news' }, { tag: 'featured' }]
 */
function transformArrayFieldToPayload(
  value: unknown,
  field: PayloadField
): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  // Check if this is a simple array with a single text field
  const subFields = field.fields || []
  if (subFields.length === 1 && subFields[0].type === 'text') {
    const fieldName = subFields[0].name
    // Check if it's already in expanded form
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
