/**
 * Payload Adapter update() Operations
 *
 * Updates documents in a Payload collection, transforming changes to Things
 * and updating relationships.
 *
 * @module @dotdo/payload/adapter/operations/update
 */

import type { ThingData } from '../../../../../types/Thing'
import type { NounData } from '../../../../../types/Noun'
import type { PayloadField, PayloadDocument } from '../types'
import { fieldNameToVerb } from '../types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Arguments for the updateOne operation
 */
export interface UpdateOneArgs {
  collection: string
  id: string
  data: Record<string, unknown>
}

/**
 * Arguments for the updateMany operation
 */
export interface UpdateManyArgs {
  collection: string
  where?: Record<string, unknown>
  data: Record<string, unknown>
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
  removeAll(from: string, verb?: string): number
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
 * Context required for update operations
 */
export interface UpdateContext {
  namespace: string
  things: ThingsStore
  relationships: RelationshipsStore
  nouns: NounsStore
  schema?: PayloadField[]
  findDocument: (collection: string, id: string) => Promise<PayloadDocument | null>
  findDocuments: (collection: string, query?: { where?: Record<string, unknown> }) => Promise<{ docs: PayloadDocument[] }>
  hooks?: {
    beforeUpdate?: ((args: { collection: string; id: string; data: Record<string, unknown> }) => Promise<Record<string, unknown>>)
    afterUpdate?: ((args: { collection: string; doc: Record<string, unknown> }) => Promise<void>)
  }
}

/**
 * Result of the updateMany operation
 */
export interface UpdateManyResult {
  updatedCount: number
}

// ============================================================================
// MAIN UPDATE ONE FUNCTION
// ============================================================================

/**
 * Update a document in a Payload collection by ID
 *
 * @param args - The update arguments (collection, id, data)
 * @param ctx - The context (stores, namespace, schema, hooks)
 * @returns The updated document
 *
 * @example
 * ```typescript
 * const doc = await updateOne(
 *   { collection: 'posts', id: 'post-1', data: { title: 'New Title' } },
 *   { namespace: 'https://test.do', things, relationships, nouns, findDocument }
 * )
 * ```
 */
export async function updateOne(
  args: UpdateOneArgs,
  ctx: UpdateContext
): Promise<PayloadDocument> {
  const { collection, id, data } = args
  const { namespace, things, relationships, schema, hooks, findDocument } = ctx

  // Find the existing document
  const existingDoc = await findDocument(collection, id)
  if (!existingDoc) {
    throw new Error(`Document with id '${id}' not found in collection '${collection}'`)
  }

  // Run beforeUpdate hook if present
  let processedData = { ...data }
  if (hooks?.beforeUpdate) {
    processedData = await hooks.beforeUpdate({
      collection,
      id,
      data: processedData,
    })
  }

  // Merge data with existing document
  const now = new Date()
  const updatedDoc: PayloadDocument = {
    ...existingDoc,
    ...processedData,
    id,
    updatedAt: now.toISOString(),
  }

  // Build Thing ID
  const thingId = `${namespace}/${collection}/${id}`

  // Get existing Thing to increment version
  const existingThing = things.get(thingId)
  const currentVersion = existingThing?.$version ?? 0

  // Transform data for Thing storage
  const thingData = transformDataForThing(updatedDoc, schema)

  // Update Thing in store (increment version for append-only behavior)
  things.update(thingId, {
    name: (updatedDoc.title as string) ?? (updatedDoc.name as string) ?? existingThing?.name,
    data: thingData,
    $version: currentVersion + 1,
    updatedAt: now,
  })

  // Update relationships for relationship/upload fields
  await updateRelationships(id, updatedDoc, collection, namespace, relationships, schema)

  // Run afterUpdate hook if present
  if (hooks?.afterUpdate) {
    await hooks.afterUpdate({
      collection,
      doc: updatedDoc,
    })
  }

  return updatedDoc
}

// ============================================================================
// MAIN UPDATE MANY FUNCTION
// ============================================================================

/**
 * Update multiple documents in a Payload collection matching a where clause
 *
 * @param args - The update arguments (collection, where, data)
 * @param ctx - The context (stores, namespace, schema, hooks)
 * @returns The count of updated documents
 *
 * @example
 * ```typescript
 * const result = await updateMany(
 *   { collection: 'posts', where: { status: { equals: 'draft' } }, data: { status: 'published' } },
 *   { namespace: 'https://test.do', things, relationships, nouns, findDocuments }
 * )
 * // Returns: { updatedCount: 3 }
 * ```
 */
export async function updateMany(
  args: UpdateManyArgs,
  ctx: UpdateContext
): Promise<UpdateManyResult> {
  const { collection, where, data } = args
  const { findDocuments, findDocument } = ctx

  // Find all matching documents
  const result = await findDocuments(collection, { where })
  const docs = result.docs

  // Update each document
  let updatedCount = 0
  for (const doc of docs) {
    await updateOne(
      { collection, id: doc.id, data },
      { ...ctx, findDocument }
    )
    updatedCount++
  }

  return { updatedCount }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Transform document data for Thing storage
 *
 * @param doc - The document to transform
 * @param schema - The field schema
 * @returns Transformed data for Thing storage
 */
function transformDataForThing(
  doc: PayloadDocument,
  schema?: PayloadField[]
): Record<string, unknown> {
  const { id, createdAt, updatedAt, title, name, ...rest } = doc
  const result: Record<string, unknown> = {}

  // Build a lookup map for schema if provided
  const fieldMap = new Map<string, PayloadField>()
  if (schema) {
    for (const field of schema) {
      fieldMap.set(field.name, field)
    }
  }

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) {
      continue
    }

    const field = fieldMap.get(key)
    result[key] = transformFieldValue(value, field)
  }

  // Include title in data if present
  if (title !== undefined) {
    result.title = title
  }

  return result
}

/**
 * Transform a single field value for Thing storage
 *
 * @param value - The field value
 * @param field - The field definition
 * @returns Transformed value
 */
function transformFieldValue(value: unknown, field?: PayloadField): unknown {
  if (value == null) {
    return value
  }

  if (!field) {
    if (value instanceof Date) {
      return value.toISOString()
    }
    return value
  }

  switch (field.type) {
    case 'date':
      return value instanceof Date ? value.toISOString() : value

    case 'richText':
      return typeof value === 'object' ? JSON.stringify(value) : value

    case 'array':
      return transformArrayValue(value, field)

    case 'blocks':
    case 'group':
      return value

    default:
      return value
  }
}

/**
 * Transform an array field value
 *
 * For simple arrays with a single text field, flatten to a simple array.
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

  return value
}

/**
 * Update relationships for a document
 *
 * This removes old relationships and creates new ones based on the updated data.
 *
 * @param docId - The document ID
 * @param doc - The updated document
 * @param collection - The collection name
 * @param namespace - The namespace URL
 * @param relationships - The relationships store
 * @param schema - The field schema
 */
async function updateRelationships(
  docId: string,
  doc: PayloadDocument,
  collection: string,
  namespace: string,
  relationships: RelationshipsStore,
  schema?: PayloadField[]
): Promise<void> {
  if (!schema) {
    return
  }

  const fromThingId = `${namespace}/${collection}/${docId}`

  for (const field of schema) {
    const value = doc[field.name]

    if (field.type === 'relationship' || field.type === 'upload') {
      const verb = fieldNameToVerb(field.name)
      const relationTo = field.relationTo

      // Remove existing relationships for this field
      const existingRels = relationships.list({ from: fromThingId, verb })
      for (const rel of existingRels) {
        relationships.remove(rel.from, rel.to, rel.verb)
      }

      // Skip if value is null/undefined
      if (value == null) {
        continue
      }

      // Check for polymorphic relationship
      if (Array.isArray(relationTo)) {
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
