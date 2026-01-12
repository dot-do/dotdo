/**
 * Thing/Payload Transformation Utilities
 *
 * Bidirectional transformations between Payload CMS documents and dotdo Things.
 * Handles field type conversion, relationship extraction, and data mapping.
 *
 * @module @dotdo/payload/strategies/things/transforms
 */

import type { PayloadDocument, PayloadField, PayloadCollection } from '../../adapter/types'
import { slugToNounName, fieldNameToVerb } from '../../adapter/types'
import type { Thing, NewThing } from '../../../../../db/things'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context for transformations
 */
export interface TransformContext {
  /** The collection slug */
  collection: string
  /** The namespace URL */
  namespace: string
  /** Field definitions for the collection */
  fields?: PayloadField[]
  /** Collection configuration */
  config?: PayloadCollection
}

/**
 * Relationship extracted from a document
 */
export interface ExtractedRelationship {
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
}

/**
 * Internal Thing representation with extended fields
 */
export interface ThingRecord {
  id: string
  type: number | string
  name?: string | null
  data?: Record<string, unknown> | null
  branch?: string | null
  deleted?: boolean
  version?: number
  createdAt?: Date
  updatedAt?: Date
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * System fields that should be excluded from data transformation
 */
const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt', '_status'])

/**
 * Field types that pass through without transformation
 */
const PASSTHROUGH_TYPES = new Set([
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
])

// ============================================================================
// PAYLOAD TO THING TRANSFORMATION
// ============================================================================

/**
 * Transform a Payload document to a Thing record.
 *
 * @param doc - The Payload document to transform
 * @param typeId - The noun type ID
 * @param ctx - Transform context
 * @returns NewThing ready for insertion
 */
export function payloadToThing(
  doc: PayloadDocument,
  typeId: number,
  ctx: TransformContext
): NewThing {
  const { id, createdAt, updatedAt, _status, title, name: docName, ...rest } = doc

  // Build the field map for efficient lookup
  const fieldMap = buildFieldMap(ctx.fields)

  // Transform data fields
  const data = transformDataToThing(rest, fieldMap)

  // Derive name from title or name field
  const name = (title as string) ?? (docName as string) ?? undefined

  return {
    id: id as string,
    type: typeId,
    branch: null, // Main branch
    name,
    data: Object.keys(data).length > 0 ? data : undefined,
    deleted: false,
  }
}

/**
 * Transform data fields from Payload format to Thing storage format.
 *
 * @param data - The Payload document data (excluding system fields)
 * @param fieldMap - Map of field names to definitions
 * @returns Transformed data object
 */
function transformDataToThing(
  data: Record<string, unknown>,
  fieldMap: Map<string, PayloadField>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || SYSTEM_FIELDS.has(key)) {
      continue
    }

    const field = fieldMap.get(key)
    result[key] = transformFieldToThing(value, field)
  }

  return result
}

/**
 * Transform a single field value from Payload to Thing format.
 *
 * @param value - The field value
 * @param field - The field definition
 * @returns Transformed value
 */
function transformFieldToThing(value: unknown, field?: PayloadField): unknown {
  if (value == null) {
    return value
  }

  // No field definition - do basic transformation
  if (!field) {
    if (value instanceof Date) {
      return value.toISOString()
    }
    return value
  }

  // Passthrough types
  if (PASSTHROUGH_TYPES.has(field.type)) {
    return value
  }

  switch (field.type) {
    case 'date':
      return value instanceof Date ? value.toISOString() : value

    case 'richText':
      // Store rich text as JSON string
      return typeof value === 'object' ? JSON.stringify(value) : value

    case 'array':
      return transformArrayToThing(value, field)

    case 'blocks':
    case 'group':
    case 'tabs':
    case 'collapsible':
    case 'row':
      // Preserve nested structures
      return value

    case 'relationship':
    case 'upload':
      // Extract IDs from relationships
      return extractRelationshipIds(value, field)

    default:
      return value
  }
}

/**
 * Transform an array field from Payload to Thing format.
 *
 * Simple arrays with a single text field are flattened.
 *
 * @param value - The array value
 * @param field - The array field definition
 * @returns Transformed array
 */
function transformArrayToThing(value: unknown, field: PayloadField): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  // Check for simple array with single text field
  const subFields = field.fields
  if (subFields && subFields.length === 1 && subFields[0]?.type === 'text') {
    const fieldName = subFields[0]!.name
    return value.map((item) => {
      if (typeof item === 'object' && item !== null && fieldName in item) {
        return (item as Record<string, unknown>)[fieldName]
      }
      return item
    })
  }

  // Complex arrays preserve structure
  return value
}

/**
 * Extract IDs from relationship field values.
 *
 * @param value - The relationship value
 * @param field - The relationship field definition
 * @returns Extracted ID(s)
 */
function extractRelationshipIds(value: unknown, field: PayloadField): unknown {
  if (value == null) {
    return value
  }

  // Handle hasMany relationships
  if (field.hasMany && Array.isArray(value)) {
    return value.map(extractSingleRelationshipId)
  }

  // Handle polymorphic relationships
  if (Array.isArray(field.relationTo) && typeof value === 'object' && value !== null) {
    const polyValue = value as { relationTo?: string; value?: unknown }
    if ('relationTo' in polyValue && 'value' in polyValue) {
      return extractSingleRelationshipId(polyValue.value)
    }
  }

  return extractSingleRelationshipId(value)
}

/**
 * Extract a single relationship ID.
 *
 * @param value - The relationship value (ID string or populated doc)
 * @returns Extracted ID
 */
function extractSingleRelationshipId(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'object' && value !== null && 'id' in value) {
    return (value as { id: unknown }).id
  }

  return value
}

// ============================================================================
// THING TO PAYLOAD TRANSFORMATION
// ============================================================================

/**
 * Transform a Thing record to a Payload document.
 *
 * @param thing - The Thing record
 * @param ctx - Transform context
 * @returns PayloadDocument
 */
export function thingToPayload(
  thing: ThingRecord,
  ctx: TransformContext
): PayloadDocument {
  const { id, data, name, createdAt, updatedAt } = thing

  // Build field map
  const fieldMap = buildFieldMap(ctx.fields)

  // Transform data fields back to Payload format
  const transformedData = data ? transformDataToPayload(data, fieldMap) : {}

  const doc: PayloadDocument = {
    id,
    ...transformedData,
  }

  // Add timestamps
  if (createdAt) {
    doc.createdAt = createdAt instanceof Date ? createdAt.toISOString() : createdAt
  }
  if (updatedAt) {
    doc.updatedAt = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt
  }

  // Add name if present and not already in data
  if (name !== undefined && name !== null && !('name' in doc)) {
    doc.name = name
  }

  return doc
}

/**
 * Transform data fields from Thing storage format to Payload format.
 *
 * @param data - The Thing data
 * @param fieldMap - Map of field names to definitions
 * @returns Transformed data object
 */
function transformDataToPayload(
  data: Record<string, unknown>,
  fieldMap: Map<string, PayloadField>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      continue
    }

    const field = fieldMap.get(key)
    result[key] = transformFieldToPayload(value, field)
  }

  return result
}

/**
 * Transform a single field value from Thing to Payload format.
 *
 * @param value - The field value
 * @param field - The field definition
 * @returns Transformed value
 */
function transformFieldToPayload(value: unknown, field?: PayloadField): unknown {
  if (value == null) {
    return value
  }

  // No field definition - pass through
  if (!field) {
    return value
  }

  // Passthrough types
  if (PASSTHROUGH_TYPES.has(field.type)) {
    return value
  }

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
      return transformArrayToPayload(value, field)

    case 'relationship':
    case 'upload':
      // Relationship IDs are kept as-is (population happens separately)
      return value

    default:
      return value
  }
}

/**
 * Transform an array field from Thing to Payload format.
 *
 * @param value - The array value
 * @param field - The array field definition
 * @returns Transformed array
 */
function transformArrayToPayload(value: unknown, field: PayloadField): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  // Check for simple array with single text field - expand back
  const subFields = field.fields
  if (subFields && subFields.length === 1 && subFields[0]?.type === 'text') {
    const fieldName = subFields[0]!.name
    // Check if already expanded
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      return value
    }
    // Expand flat array
    return value.map((item) => ({ [fieldName]: item }))
  }

  return value
}

// ============================================================================
// RELATIONSHIP EXTRACTION
// ============================================================================

/**
 * Extract relationships from a Payload document.
 *
 * @param doc - The Payload document
 * @param ctx - Transform context
 * @returns Array of extracted relationships
 */
export function extractRelationships(
  doc: PayloadDocument,
  ctx: TransformContext
): ExtractedRelationship[] {
  const { collection, namespace, fields } = ctx

  if (!fields) {
    return []
  }

  const relationships: ExtractedRelationship[] = []
  const fromThingId = `${namespace}/${collection}/${doc.id}`

  for (const field of fields) {
    if (field.type !== 'relationship' && field.type !== 'upload') {
      continue
    }

    const value = doc[field.name]
    if (value == null) {
      continue
    }

    const verb = fieldNameToVerb(field.name)
    const relationTo = field.relationTo

    // Handle polymorphic relationships
    if (Array.isArray(relationTo)) {
      if (typeof value === 'object' && value !== null && 'relationTo' in value && 'value' in value) {
        const polyValue = value as { relationTo: string; value: unknown }
        const toCollection = polyValue.relationTo
        const toId = String(polyValue.value)
        relationships.push({
          verb,
          from: fromThingId,
          to: `${namespace}/${toCollection}/${toId}`,
          data: { relationTo: toCollection },
        })
      }
      continue
    }

    // Handle hasMany relationships
    if (field.hasMany && Array.isArray(value)) {
      for (const relatedId of value) {
        const toCollection = relationTo || 'unknown'
        relationships.push({
          verb,
          from: fromThingId,
          to: `${namespace}/${toCollection}/${String(relatedId)}`,
        })
      }
      continue
    }

    // Handle single relationship
    const toCollection = relationTo || 'unknown'
    relationships.push({
      verb,
      from: fromThingId,
      to: `${namespace}/${toCollection}/${String(value)}`,
    })
  }

  return relationships
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Build a field map for efficient lookup.
 *
 * @param fields - Array of field definitions
 * @returns Map of field names to definitions
 */
function buildFieldMap(fields?: PayloadField[]): Map<string, PayloadField> {
  const map = new Map<string, PayloadField>()
  if (fields) {
    for (const field of fields) {
      map.set(field.name, field)
    }
  }
  return map
}

/**
 * Generate a Thing ID from collection and document ID.
 *
 * @param namespace - The namespace URL
 * @param collection - The collection slug
 * @param id - The document ID
 * @returns Full Thing ID
 */
export function getThingId(namespace: string, collection: string, id: string): string {
  return `${namespace}/${collection}/${id}`
}

/**
 * Parse a Thing ID to extract collection and document ID.
 *
 * @param thingId - The Thing ID
 * @param namespace - The namespace URL
 * @returns Parsed components or null if invalid
 */
export function parseThingId(
  thingId: string,
  namespace: string
): { collection: string; id: string } | null {
  const prefix = `${namespace}/`
  if (!thingId.startsWith(prefix)) {
    return null
  }

  const path = thingId.slice(prefix.length)
  const parts = path.split('/')

  if (parts.length < 2) {
    return null
  }

  const collection = parts[0]!
  const id = parts.slice(1).join('/')

  return { collection, id }
}

/**
 * Get the Noun name for a collection slug.
 *
 * @param collection - The collection slug
 * @returns Noun name (PascalCase)
 */
export function getNounName(collection: string): string {
  return slugToNounName(collection)
}

/**
 * Get the version Thing ID for a document version.
 *
 * @param namespace - The namespace URL
 * @param collection - The collection slug
 * @param docId - The document ID
 * @param versionNumber - The version number
 * @returns Version Thing ID
 */
export function getVersionThingId(
  namespace: string,
  collection: string,
  docId: string,
  versionNumber: number
): string {
  return `${namespace}/${collection}/${docId}:v${versionNumber}`
}

/**
 * Get the version type for a collection's versions.
 *
 * @param namespace - The namespace URL
 * @param collection - The collection slug
 * @returns Version type string
 */
export function getVersionType(namespace: string, collection: string): string {
  return `${namespace}/_versions/${collection}`
}

/**
 * Get the global Thing ID.
 *
 * @param namespace - The namespace URL
 * @param slug - The global slug
 * @returns Global Thing ID
 */
export function getGlobalThingId(namespace: string, slug: string): string {
  return `${namespace}/globals/${slug}`
}

/**
 * Get the globals type.
 *
 * @param namespace - The namespace URL
 * @returns Globals type string
 */
export function getGlobalsType(namespace: string): string {
  return `${namespace}/globals`
}
