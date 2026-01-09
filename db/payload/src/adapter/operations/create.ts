/**
 * Payload Adapter create() Operation
 *
 * Creates a new document in a Payload collection, transforming it to a Thing
 * and setting up relationships.
 *
 * @module @dotdo/payload/adapter/operations/create
 */

import type { ThingData } from '../../../../../types/Thing'
import type { NounData } from '../../../../../types/Noun'
import type { PayloadField, PayloadDocument } from '../types'
import { slugToNounName, fieldNameToVerb } from '../types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Arguments for the create operation
 */
export interface CreateArgs {
  collection: string
  data: Record<string, unknown>
  req?: { transactionID?: string }
}

/**
 * Store interface for Things
 */
export interface ThingsStore {
  get(id: string): ThingData | undefined
  list(options?: { type?: string }): ThingData[]
  create(data: Partial<ThingData> & { $id: string; $type: string }): ThingData
  update(id: string, data: Partial<ThingData>): ThingData | undefined
  delete(id: string): boolean
  clear(): void
}

/**
 * Store interface for Relationships
 */
export interface RelationshipsStore {
  add(rel: { from: string; to: string; verb: string; data?: Record<string, unknown> }): void
  list(options?: { from?: string; to?: string; verb?: string }): Array<{
    from: string
    to: string
    verb: string
    data?: Record<string, unknown>
  }>
  remove(from: string, to: string, verb: string): boolean
  clear(): void
}

/**
 * Store interface for Nouns
 */
export interface NounsStore {
  get(noun: string): NounData | undefined
  set(noun: string, data: NounData): void
  list(): NounData[]
  clear(): void
}

/**
 * Context required for create operation
 */
export interface CreateContext {
  namespace: string
  things: ThingsStore
  relationships: RelationshipsStore
  nouns: NounsStore
  schema?: PayloadField[]
  hooks?: {
    beforeCreate?: ((args: { collection: string; data: Record<string, unknown>; operation: string }) => Promise<Record<string, unknown>>)
    afterCreate?: ((args: { collection: string; doc: Record<string, unknown> }) => Promise<void>)
  }
}

/**
 * Result of the create operation - the created document
 */
export type CreateResult = PayloadDocument

// ============================================================================
// MAIN CREATE FUNCTION
// ============================================================================

/**
 * Create a new document in a Payload collection
 *
 * @param args - The create arguments (collection, data)
 * @param ctx - The context (stores, namespace, schema, hooks)
 * @returns The created document with id, timestamps, and all fields
 *
 * @example
 * ```typescript
 * const doc = await create(
 *   { collection: 'posts', data: { title: 'Hello World' } },
 *   { namespace: 'https://test.do', things, relationships, nouns }
 * )
 * // Returns: { id: '...', title: 'Hello World', createdAt: '...', updatedAt: '...' }
 * ```
 */
export async function create(
  args: CreateArgs,
  ctx: CreateContext
): Promise<CreateResult> {
  const { collection, data } = args
  const { namespace, things, relationships, nouns, schema, hooks } = ctx

  // Generate ID if not provided
  const id = (data.id as string) || generateId()

  // Check for duplicate
  const thingId = `${namespace}/${collection}/${id}`
  const existing = things.get(thingId)
  if (existing) {
    throw new Error(`Document with id '${id}' already exists in collection '${collection}'`)
  }

  // Run beforeCreate hook if present
  let processedData = { ...data }
  if (hooks?.beforeCreate) {
    processedData = await hooks.beforeCreate({
      collection,
      data: processedData,
      operation: 'create',
    })
  }

  // Register noun if first document in collection (or always ensure it exists)
  await ensureNounExists(nouns, collection, namespace)

  // Create timestamps
  const now = new Date()
  const docWithTimestamps: PayloadDocument = {
    ...processedData,
    id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }

  // Transform to Thing data format
  const thingData = transformDocumentToThing(docWithTimestamps, {
    collection,
    namespace,
    schema,
  })

  // Create Thing in store
  things.create(thingData)

  // Create relationships for relationship/upload fields
  await createRelationships(docWithTimestamps, collection, namespace, relationships, schema)

  // Run afterCreate hook if present
  if (hooks?.afterCreate) {
    await hooks.afterCreate({
      collection,
      doc: docWithTimestamps,
    })
  }

  return docWithTimestamps
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique ID using crypto.randomUUID
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Ensure a Noun exists for the given collection
 *
 * @param nouns - The nouns store
 * @param collection - The collection slug (e.g., 'articles')
 * @param namespace - The namespace URL
 */
async function ensureNounExists(
  nouns: NounsStore,
  collection: string,
  namespace: string
): Promise<void> {
  const nounName = slugToNounName(collection)
  const existing = nouns.get(nounName)

  if (!existing) {
    const nounData: NounData = {
      noun: nounName,
      plural: collection, // The collection slug is typically plural
      description: `${nounName} entity from ${collection} collection`,
    }
    nouns.set(nounName, nounData)
  }
}

/**
 * Transform context for document to Thing conversion
 */
interface TransformContext {
  collection: string
  namespace: string
  schema?: PayloadField[]
}

/**
 * Transform a Payload document to Thing data format
 *
 * @param doc - The Payload document
 * @param ctx - The transformation context
 * @returns Thing data ready for storage
 */
function transformDocumentToThing(
  doc: PayloadDocument,
  ctx: TransformContext
): Partial<ThingData> & { $id: string; $type: string } {
  const { collection, namespace, schema } = ctx
  const { id, createdAt, updatedAt, title, name: docName, ...rest } = doc

  const $id = `${namespace}/${collection}/${id}`
  const $type = `${namespace}/${collection}`

  // Transform field values to Thing format
  const data = transformFieldsToThingData(rest, schema)

  // Include title in data if present
  if (title !== undefined) {
    data.title = title as string
  }

  return {
    $id,
    $type,
    name: (title as string) ?? (docName as string) ?? undefined,
    data: Object.keys(data).length > 0 ? data : undefined,
    createdAt: createdAt ? new Date(createdAt as string) : new Date(),
    updatedAt: updatedAt ? new Date(updatedAt as string) : new Date(),
  }
}

/**
 * Transform field values from Payload format to Thing data format
 *
 * - Dates are converted to ISO strings
 * - Rich text is stringified to JSON
 * - Simple arrays (with single text field) are flattened
 * - Blocks preserve their structure
 *
 * @param data - The Payload document data
 * @param schema - The field definitions
 * @returns Transformed data for Thing storage
 */
function transformFieldsToThingData(
  data: Record<string, unknown>,
  schema?: PayloadField[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // Build a lookup map for schema if provided
  const fieldMap = new Map<string, PayloadField>()
  if (schema) {
    for (const field of schema) {
      fieldMap.set(field.name, field)
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      continue // Skip undefined values
    }

    const field = fieldMap.get(key)
    result[key] = transformFieldValue(value, field)
  }

  return result
}

/**
 * Transform a single field value from Payload to Thing format
 *
 * @param value - The field value
 * @param field - The field definition (optional)
 * @returns The transformed value
 */
function transformFieldValue(value: unknown, field?: PayloadField): unknown {
  if (value == null) {
    return value
  }

  // If no field definition, pass through
  if (!field) {
    // Handle Date objects
    if (value instanceof Date) {
      return value.toISOString()
    }
    return value
  }

  switch (field.type) {
    case 'date':
      return value instanceof Date ? value.toISOString() : value

    case 'richText':
      // Rich text should be stored as JSON string
      return typeof value === 'object' ? JSON.stringify(value) : value

    case 'array':
      return transformArrayValue(value, field)

    case 'blocks':
      // Blocks preserve their structure with blockType
      return value

    case 'group':
      // Groups are preserved as nested objects
      return value

    default:
      // Text, number, checkbox, select, etc. pass through
      return value
  }
}

/**
 * Transform an array field value
 *
 * For simple arrays with a single text field, flatten to a simple array.
 * For complex arrays, preserve the full structure.
 *
 * @param value - The array value
 * @param field - The array field definition
 * @returns The transformed array
 */
function transformArrayValue(value: unknown, field: PayloadField): unknown {
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
 * Create relationships for relationship/upload fields in a document
 *
 * @param doc - The created document
 * @param collection - The collection name
 * @param namespace - The namespace URL
 * @param relationships - The relationships store
 * @param schema - The field definitions
 */
async function createRelationships(
  doc: PayloadDocument,
  collection: string,
  namespace: string,
  relationships: RelationshipsStore,
  schema?: PayloadField[]
): Promise<void> {
  if (!schema) {
    return
  }

  const fromThingId = `${namespace}/${collection}/${doc.id}`

  for (const field of schema) {
    const value = doc[field.name]
    if (value == null) {
      continue
    }

    if (field.type === 'relationship' || field.type === 'upload') {
      const verb = fieldNameToVerb(field.name)
      const relationTo = field.relationTo

      // Check for polymorphic relationship (array of relationTo)
      if (Array.isArray(relationTo)) {
        // Polymorphic relationship format: { relationTo: 'pages', value: 'page-123' }
        if (typeof value === 'object' && value !== null && 'relationTo' in value && 'value' in value) {
          const polyValue = value as { relationTo: string; value: unknown }
          const toCollection = polyValue.relationTo
          const toId = String(polyValue.value)
          const toThingId = `${namespace}/${toCollection}/${toId}`

          relationships.add({
            from: fromThingId,
            to: toThingId,
            verb,
            data: { relationTo: toCollection },
          })
        }
      } else if (field.hasMany && Array.isArray(value)) {
        // hasMany relationship: array of IDs
        for (const relatedId of value) {
          const toCollection = relationTo || 'unknown'
          const toThingId = `${namespace}/${toCollection}/${String(relatedId)}`
          relationships.add({
            from: fromThingId,
            to: toThingId,
            verb,
          })
        }
      } else {
        // hasOne relationship: single ID
        const toCollection = relationTo || 'unknown'
        const toThingId = `${namespace}/${toCollection}/${String(value)}`
        relationships.add({
          from: fromThingId,
          to: toThingId,
          verb,
        })
      }
    }
  }
}
