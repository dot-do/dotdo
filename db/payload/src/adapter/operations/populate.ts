/**
 * Payload Adapter Relationship Population
 *
 * Populates relationship and upload fields in Payload documents,
 * with depth control and circular reference handling.
 *
 * @module @dotdo/payload/adapter/operations/populate
 */

import type { PayloadField, PayloadDocument } from '../types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Store interface for document lookups
 */
export interface DocumentStore {
  get(collection: string, id: string): PayloadDocument | undefined
  list(collection: string): PayloadDocument[]
}

/**
 * Store interface for relationships
 */
export interface RelationshipsStore {
  list(options?: { from?: string; to?: string; verb?: string }): Array<{
    from: string
    to: string
    verb: string
    data?: Record<string, unknown>
  }>
}

/**
 * Schema provider interface
 */
export interface SchemaProvider {
  getFields(collection: string): PayloadField[]
}

/**
 * Context required for population operations
 */
export interface PopulateContext {
  /** The dotdo namespace URL */
  namespace: string
  /** Document store for fetching related documents */
  documents: DocumentStore
  /** Relationships store (optional, for relationship-based lookups) */
  relationships?: RelationshipsStore
  /** Schema provider for field definitions */
  schema: SchemaProvider
}

/**
 * Options for population
 */
export interface PopulateOptions {
  /** Maximum depth to populate (0 = no population) */
  depth?: number
  /** Fields to populate (default: all relationship/upload fields) */
  fields?: string[]
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default depth for population when not specified */
const DEFAULT_DEPTH = 1

// ============================================================================
// MAIN POPULATION FUNCTION
// ============================================================================

/**
 * Populate relationships in a Payload document
 *
 * @param doc - The document to populate
 * @param collection - The collection name
 * @param ctx - The population context
 * @param options - Population options (depth, fields)
 * @returns The document with populated relationships
 *
 * @example
 * ```typescript
 * const populated = await populateDocument(
 *   { id: 'post-1', author: 'user-1' },
 *   'posts',
 *   { namespace: 'https://test.do', documents, schema },
 *   { depth: 1 }
 * )
 * // Returns: { id: 'post-1', author: { id: 'user-1', name: 'Alice', ... } }
 * ```
 */
export function populateDocument(
  doc: PayloadDocument,
  collection: string,
  ctx: PopulateContext,
  options: PopulateOptions = {},
  visited: Set<string> = new Set()
): PayloadDocument {
  const depth = options.depth ?? DEFAULT_DEPTH

  // At depth 0, return document as-is (relationships remain as IDs)
  if (depth <= 0) {
    return doc
  }

  // Check for circular reference
  const docKey = `${collection}/${doc.id}`
  if (visited.has(docKey)) {
    // Return document without further population to break circular reference
    return doc
  }
  visited.add(docKey)

  // Get schema fields for this collection
  const fields = ctx.schema.getFields(collection)
  if (!fields || fields.length === 0) {
    return doc
  }

  // Create a copy of the document for population
  const populated: PayloadDocument = { ...doc }

  // Process each relationship/upload field
  for (const field of fields) {
    if (field.type !== 'relationship' && field.type !== 'upload') {
      continue
    }

    // Skip if field is not in options.fields (when specified)
    if (options.fields && !options.fields.includes(field.name)) {
      continue
    }

    const value = doc[field.name]

    // Skip null/undefined values
    if (value == null) {
      populated[field.name] = null
      continue
    }

    // Handle polymorphic relationships (array of relationTo)
    if (Array.isArray(field.relationTo)) {
      populated[field.name] = populatePolymorphic(
        value,
        field,
        ctx,
        depth,
        visited
      )
    } else if (field.hasMany && Array.isArray(value)) {
      // Handle hasMany relationships
      populated[field.name] = populateHasMany(
        value,
        field.relationTo as string,
        ctx,
        depth,
        visited
      )
    } else {
      // Handle hasOne relationships
      populated[field.name] = populateHasOne(
        value,
        field.relationTo as string,
        ctx,
        depth,
        visited
      )
    }
  }

  return populated
}

/**
 * Populate multiple documents (batch operation)
 *
 * @param docs - The documents to populate
 * @param collection - The collection name
 * @param ctx - The population context
 * @param options - Population options
 * @returns The documents with populated relationships
 */
export function populateDocuments(
  docs: PayloadDocument[],
  collection: string,
  ctx: PopulateContext,
  options: PopulateOptions = {}
): PayloadDocument[] {
  const depth = options.depth ?? DEFAULT_DEPTH

  // At depth 0, return documents as-is
  if (depth <= 0) {
    return docs
  }

  // Batch population: collect all IDs first, then fetch in batches
  // For now, we do individual population (can optimize later)
  return docs.map((doc) =>
    populateDocument(doc, collection, ctx, options, new Set())
  )
}

// ============================================================================
// POPULATION HELPERS
// ============================================================================

/**
 * Populate a hasOne relationship field
 *
 * @param value - The relationship value (ID string or already populated object)
 * @param relationTo - The target collection name
 * @param ctx - The population context
 * @param depth - Current depth
 * @param visited - Set of visited document keys for circular reference detection
 * @returns The populated document or null if not found
 */
function populateHasOne(
  value: unknown,
  relationTo: string,
  ctx: PopulateContext,
  depth: number,
  visited: Set<string>
): PayloadDocument | null | string {
  // If already an object with id, it might already be populated
  if (typeof value === 'object' && value !== null && 'id' in value) {
    // Already populated, but we might need to go deeper
    const existingDoc = value as PayloadDocument
    if (depth > 1) {
      return populateDocument(
        existingDoc,
        relationTo,
        ctx,
        { depth: depth - 1 },
        new Set(visited)
      )
    }
    return existingDoc
  }

  // Value is an ID string
  if (typeof value !== 'string') {
    return null
  }

  const id = value
  const relatedDoc = ctx.documents.get(relationTo, id)

  if (!relatedDoc) {
    // Document not found, return null
    return null
  }

  // Recursively populate if depth > 1
  if (depth > 1) {
    return populateDocument(
      relatedDoc,
      relationTo,
      ctx,
      { depth: depth - 1 },
      new Set(visited)
    )
  }

  return relatedDoc
}

/**
 * Populate a hasMany relationship field
 *
 * @param values - Array of relationship values (ID strings)
 * @param relationTo - The target collection name
 * @param ctx - The population context
 * @param depth - Current depth
 * @param visited - Set of visited document keys for circular reference detection
 * @returns Array of populated documents
 */
function populateHasMany(
  values: unknown[],
  relationTo: string,
  ctx: PopulateContext,
  depth: number,
  visited: Set<string>
): Array<PayloadDocument | null> {
  return values
    .map((value) => populateHasOne(value, relationTo, ctx, depth, visited))
    .filter((doc): doc is PayloadDocument => doc !== null && typeof doc !== 'string')
}

/**
 * Populate a polymorphic relationship field
 *
 * Polymorphic relationships have format: { relationTo: 'collection', value: 'id' }
 * or for hasMany: [{ relationTo: 'collection', value: 'id' }, ...]
 *
 * @param value - The polymorphic value
 * @param field - The field definition
 * @param ctx - The population context
 * @param depth - Current depth
 * @param visited - Set of visited document keys for circular reference detection
 * @returns The populated polymorphic value
 */
function populatePolymorphic(
  value: unknown,
  field: PayloadField,
  ctx: PopulateContext,
  depth: number,
  visited: Set<string>
): unknown {
  // Handle hasMany polymorphic
  if (field.hasMany && Array.isArray(value)) {
    return value.map((item) =>
      populatePolymorphicItem(item, ctx, depth, visited)
    )
  }

  // Handle hasOne polymorphic
  return populatePolymorphicItem(value, ctx, depth, visited)
}

/**
 * Populate a single polymorphic relationship item
 *
 * @param item - The polymorphic item { relationTo, value }
 * @param ctx - The population context
 * @param depth - Current depth
 * @param visited - Set of visited document keys
 * @returns The populated polymorphic item
 */
function populatePolymorphicItem(
  item: unknown,
  ctx: PopulateContext,
  depth: number,
  visited: Set<string>
): unknown {
  if (typeof item !== 'object' || item === null) {
    return item
  }

  const polyItem = item as { relationTo?: string; value?: unknown }

  if (!('relationTo' in polyItem) || !('value' in polyItem)) {
    return item
  }

  const { relationTo, value } = polyItem

  if (typeof relationTo !== 'string') {
    return item
  }

  // Populate the value
  const populatedValue = populateHasOne(value, relationTo, ctx, depth, visited)

  return {
    relationTo,
    value: populatedValue ?? value,
  }
}

// ============================================================================
// BATCH POPULATION (OPTIMIZATION)
// ============================================================================

/**
 * Collect all relationship IDs from documents for batch fetching
 *
 * @param docs - The documents to analyze
 * @param collection - The collection name
 * @param ctx - The population context
 * @returns Map of collection -> Set of IDs to fetch
 */
export function collectRelationshipIds(
  docs: PayloadDocument[],
  collection: string,
  ctx: PopulateContext
): Map<string, Set<string>> {
  const idsMap = new Map<string, Set<string>>()
  const fields = ctx.schema.getFields(collection)

  for (const doc of docs) {
    for (const field of fields) {
      if (field.type !== 'relationship' && field.type !== 'upload') {
        continue
      }

      const value = doc[field.name]
      if (value == null) continue

      if (Array.isArray(field.relationTo)) {
        // Polymorphic - collect from nested structure
        collectPolymorphicIds(value, field, idsMap)
      } else if (field.hasMany && Array.isArray(value)) {
        const relationTo = field.relationTo as string
        for (const id of value) {
          if (typeof id === 'string') {
            addToIdsMap(idsMap, relationTo, id)
          }
        }
      } else if (typeof value === 'string') {
        const relationTo = field.relationTo as string
        addToIdsMap(idsMap, relationTo, value)
      }
    }
  }

  return idsMap
}

/**
 * Add an ID to the collection IDs map
 */
function addToIdsMap(
  map: Map<string, Set<string>>,
  collection: string,
  id: string
): void {
  if (!map.has(collection)) {
    map.set(collection, new Set())
  }
  map.get(collection)!.add(id)
}

/**
 * Collect IDs from polymorphic relationship values
 */
function collectPolymorphicIds(
  value: unknown,
  field: PayloadField,
  idsMap: Map<string, Set<string>>
): void {
  if (field.hasMany && Array.isArray(value)) {
    for (const item of value) {
      collectPolymorphicItemIds(item, idsMap)
    }
  } else {
    collectPolymorphicItemIds(value, idsMap)
  }
}

/**
 * Collect IDs from a single polymorphic item
 */
function collectPolymorphicItemIds(
  item: unknown,
  idsMap: Map<string, Set<string>>
): void {
  if (typeof item !== 'object' || item === null) return

  const polyItem = item as { relationTo?: string; value?: unknown }
  if (!('relationTo' in polyItem) || !('value' in polyItem)) return

  const { relationTo, value } = polyItem
  if (typeof relationTo === 'string' && typeof value === 'string') {
    addToIdsMap(idsMap, relationTo, value)
  }
}
