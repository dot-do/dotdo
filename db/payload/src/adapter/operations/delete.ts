/**
 * Payload Adapter delete() Operations
 *
 * Deletes documents from a Payload collection with soft delete behavior,
 * removing relationships and updating Things.
 *
 * @module @dotdo/payload/adapter/operations/delete
 */

import type { ThingData } from '../../../../../types/Thing'
import type { NounData } from '../../../../../types/Noun'
import type { PayloadField, PayloadDocument } from '../types'
import { fieldNameToVerb } from '../types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Arguments for the deleteOne operation
 */
export interface DeleteOneArgs {
  collection: string
  id: string
}

/**
 * Arguments for the deleteMany operation
 */
export interface DeleteManyArgs {
  collection: string
  where?: Record<string, unknown>
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
 * Context required for delete operations
 */
export interface DeleteContext {
  namespace: string
  things: ThingsStore
  relationships: RelationshipsStore
  nouns: NounsStore
  schema?: PayloadField[]
  findDocument: (collection: string, id: string) => Promise<PayloadDocument | null>
  findDocuments: (collection: string, query?: { where?: Record<string, unknown> }) => Promise<{ docs: PayloadDocument[] }>
  deleteFromCollection: (collection: string, id: string) => void
  hooks?: {
    beforeDelete?: ((args: { collection: string; id: string }) => Promise<void>)
    afterDelete?: ((args: { collection: string; doc: Record<string, unknown> }) => Promise<void>)
  }
}

/**
 * Result of the deleteMany operation
 */
export interface DeleteManyResult {
  deletedCount: number
}

// ============================================================================
// MAIN DELETE ONE FUNCTION
// ============================================================================

/**
 * Delete (soft delete) a document from a Payload collection by ID
 *
 * Performs a soft delete by setting $deleted flag on the Thing.
 * Also removes all relationships from this document.
 *
 * @param args - The delete arguments (collection, id)
 * @param ctx - The context (stores, namespace, schema, hooks)
 * @returns The deleted document
 *
 * @example
 * ```typescript
 * const doc = await deleteOne(
 *   { collection: 'posts', id: 'post-1' },
 *   { namespace: 'https://test.do', things, relationships, nouns, findDocument }
 * )
 * ```
 */
export async function deleteOne(
  args: DeleteOneArgs,
  ctx: DeleteContext
): Promise<PayloadDocument> {
  const { collection, id } = args
  const { namespace, things, relationships, schema, hooks, findDocument, deleteFromCollection } = ctx

  // Find the existing document
  const existingDoc = await findDocument(collection, id)
  if (!existingDoc) {
    throw new Error(`Document with id '${id}' not found in collection '${collection}'`)
  }

  // Run beforeDelete hook if present
  if (hooks?.beforeDelete) {
    await hooks.beforeDelete({
      collection,
      id,
    })
  }

  // Build Thing ID
  const thingId = `${namespace}/${collection}/${id}`

  // Remove all relationships from this document
  await removeAllRelationships(thingId, relationships, schema)

  // Soft delete: mark Thing as deleted
  const existingThing = things.get(thingId)
  things.update(thingId, {
    $deleted: true,
    deletedAt: new Date(),
  } as any)

  // Remove from collection (mock storage)
  deleteFromCollection(collection, id)

  // Run afterDelete hook if present
  if (hooks?.afterDelete) {
    await hooks.afterDelete({
      collection,
      doc: existingDoc,
    })
  }

  return existingDoc
}

// ============================================================================
// MAIN DELETE MANY FUNCTION
// ============================================================================

/**
 * Delete multiple documents from a Payload collection matching a where clause
 *
 * @param args - The delete arguments (collection, where)
 * @param ctx - The context (stores, namespace, schema, hooks)
 * @returns The count of deleted documents
 *
 * @example
 * ```typescript
 * const result = await deleteMany(
 *   { collection: 'posts', where: { status: { equals: 'draft' } } },
 *   { namespace: 'https://test.do', things, relationships, nouns, findDocuments }
 * )
 * // Returns: { deletedCount: 3 }
 * ```
 */
export async function deleteMany(
  args: DeleteManyArgs,
  ctx: DeleteContext
): Promise<DeleteManyResult> {
  const { collection, where } = args
  const { findDocuments } = ctx

  // Find all matching documents
  const result = await findDocuments(collection, { where })
  const docs = result.docs

  // Delete each document
  let deletedCount = 0
  for (const doc of docs) {
    await deleteOne(
      { collection, id: doc.id },
      ctx
    )
    deletedCount++
  }

  return { deletedCount }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Remove all relationships from a document
 *
 * @param thingId - The Thing ID
 * @param relationships - The relationships store
 * @param schema - The field schema
 */
async function removeAllRelationships(
  thingId: string,
  relationships: RelationshipsStore,
  schema?: PayloadField[]
): Promise<void> {
  // Get all relationships from this Thing
  const allRels = relationships.list({ from: thingId })

  // Remove each relationship
  for (const rel of allRels) {
    relationships.remove(rel.from, rel.to, rel.verb)
  }
}
