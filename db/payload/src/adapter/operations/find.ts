/**
 * Payload Adapter find() and findOne() Operations
 *
 * Implements querying documents with filtering, sorting, pagination,
 * and relationship population.
 *
 * @module @dotdo/payload/adapter/operations/find
 */

import type { ThingData } from '../../../../../types/Thing'
import type { PayloadField, PayloadDocument } from '../types'

// ============================================================================
// TYPES
// ============================================================================

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
 * Payload where clause operator
 */
export interface WhereOperator {
  equals?: unknown
  not_equals?: unknown
  in?: unknown[]
  not_in?: unknown[]
  greater_than?: unknown
  greater_than_equal?: unknown
  less_than?: unknown
  less_than_equal?: unknown
  like?: string
  contains?: string
  exists?: boolean
}

/**
 * Payload where clause structure
 */
export interface WhereClause {
  [field: string]: WhereOperator | WhereClause[] | undefined
  and?: WhereClause[]
  or?: WhereClause[]
}

/**
 * Arguments for the find operation
 */
export interface FindArgs {
  collection: string
  where?: WhereClause
  sort?: string
  limit?: number
  page?: number
  depth?: number
}

/**
 * Arguments for the findOne operation
 */
export interface FindOneArgs {
  collection: string
  id?: string
  where?: WhereClause
  depth?: number
}

/**
 * Result of the find operation
 */
export interface FindResult {
  docs: Record<string, unknown>[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

/**
 * Context required for find operations
 */
export interface FindContext {
  namespace: string
  things: ThingsStore
  relationships: RelationshipsStore
  schema?: PayloadField[]
  /** Map of collection name to schema */
  schemas?: Map<string, PayloadField[]>
}

// ============================================================================
// MAIN FIND FUNCTION
// ============================================================================

/**
 * Find documents in a Payload collection
 *
 * @param args - The find arguments (collection, where, sort, limit, page, depth)
 * @param ctx - The context (stores, namespace, schema)
 * @returns Paginated results with docs, totalDocs, and pagination metadata
 */
export async function find(args: FindArgs, ctx: FindContext): Promise<FindResult> {
  const { collection, where, sort, limit = 10, page = 1, depth = 1 } = args
  const { namespace, things } = ctx

  // Build query type URL
  const typeUrl = `${namespace}/${collection}`

  // Get all things of this type
  let results = things.list({ type: typeUrl })

  // Apply where filter
  if (where) {
    results = filterByWhere(results, where, namespace)
  }

  // Apply sort
  if (sort) {
    results = sortResults(results, sort)
  }

  // Calculate pagination
  const totalDocs = results.length
  // Handle limit of 0 as "return all"
  const effectiveLimit = limit === 0 ? totalDocs || 1 : limit
  const totalPages = Math.max(1, Math.ceil(totalDocs / effectiveLimit))
  const offset = (page - 1) * effectiveLimit
  const paginatedResults = limit === 0 ? results : results.slice(offset, offset + effectiveLimit)

  // Transform to Payload format and populate
  const docs = await Promise.all(
    paginatedResults.map(async (thing) => {
      const doc = transformThingToPayload(thing, { collection, namespace })
      if (depth > 0) {
        return populateRelationships(doc, depth, collection, ctx)
      }
      return doc
    })
  )

  return {
    docs,
    totalDocs,
    limit: effectiveLimit,
    page,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }
}

// ============================================================================
// MAIN FINDONE FUNCTION
// ============================================================================

/**
 * Find a single document in a Payload collection
 *
 * @param args - The findOne arguments (collection, id, where, depth)
 * @param ctx - The context (stores, namespace, schema)
 * @returns The found document or null
 */
export async function findOne(args: FindOneArgs, ctx: FindContext): Promise<Record<string, unknown> | null> {
  const { collection, id, where, depth = 1 } = args
  const { namespace, things } = ctx

  // If id is provided, look up directly
  if (id) {
    const thingId = `${namespace}/${collection}/${id}`
    const thing = things.get(thingId)

    if (!thing) {
      return null
    }

    const doc = transformThingToPayload(thing, { collection, namespace })
    if (depth > 0) {
      return populateRelationships(doc, depth, collection, ctx)
    }
    return doc
  }

  // If no id, use find with limit 1
  const result = await find({ collection, where, limit: 1, depth }, ctx)
  return result.docs[0] ?? null
}

// ============================================================================
// FILTERING HELPERS
// ============================================================================

/**
 * Filter results by where clause
 */
function filterByWhere(results: ThingData[], where: WhereClause, namespace: string): ThingData[] {
  return results.filter((thing) => matchesWhere(thing, where, namespace))
}

/**
 * Check if a thing matches a where clause
 */
function matchesWhere(thing: ThingData, where: WhereClause, namespace: string): boolean {
  // Handle AND
  if (where.and && Array.isArray(where.and)) {
    return where.and.every((clause) => matchesWhere(thing, clause, namespace))
  }

  // Handle OR
  if (where.or && Array.isArray(where.or)) {
    return where.or.some((clause) => matchesWhere(thing, clause, namespace))
  }

  // Handle field operators
  for (const [field, operators] of Object.entries(where)) {
    if (field === 'and' || field === 'or') continue
    if (!operators || typeof operators !== 'object') continue

    const value = getFieldValue(thing, field)
    if (!matchesOperators(value, operators as WhereOperator, thing)) {
      return false
    }
  }

  return true
}

/**
 * Get a field value from a thing (supports nested paths)
 */
function getFieldValue(thing: ThingData, field: string): unknown {
  // Handle system fields
  if (field === 'createdAt') return thing.createdAt
  if (field === 'updatedAt') return thing.updatedAt
  if (field === 'id') return thing.$id?.split('/').pop()

  // Handle nested paths
  const parts = field.split('.')
  let value: unknown = thing.data

  for (const part of parts) {
    if (value == null) return undefined
    if (typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[part]
  }

  return value
}

/**
 * Check if a value matches operators
 */
function matchesOperators(value: unknown, operators: WhereOperator, thing: ThingData): boolean {
  for (const [op, operand] of Object.entries(operators)) {
    if (!matchesOperator(value, op, operand, thing)) {
      return false
    }
  }
  return true
}

/**
 * Check if a value matches a single operator
 */
function matchesOperator(value: unknown, op: string, operand: unknown, thing: ThingData): boolean {
  switch (op) {
    case 'equals':
      return value === operand

    case 'not_equals':
      return value !== operand

    case 'in':
      if (!Array.isArray(operand)) return false
      return operand.includes(value)

    case 'not_in':
      if (!Array.isArray(operand)) return false
      return !operand.includes(value)

    case 'greater_than':
      if (typeof value === 'number' && typeof operand === 'number') {
        return value > operand
      }
      if (value instanceof Date && operand instanceof Date) {
        return value > operand
      }
      if (typeof value === 'string' && typeof operand === 'string') {
        return value > operand
      }
      return false

    case 'greater_than_equal':
      if (typeof value === 'number' && typeof operand === 'number') {
        return value >= operand
      }
      if (value instanceof Date && operand instanceof Date) {
        return value >= operand
      }
      if (typeof value === 'string' && typeof operand === 'string') {
        return value >= operand
      }
      return false

    case 'less_than':
      if (typeof value === 'number' && typeof operand === 'number') {
        return value < operand
      }
      if (value instanceof Date && operand instanceof Date) {
        return value < operand
      }
      if (typeof value === 'string' && typeof operand === 'string') {
        return value < operand
      }
      return false

    case 'less_than_equal':
      if (typeof value === 'number' && typeof operand === 'number') {
        return value <= operand
      }
      if (value instanceof Date && operand instanceof Date) {
        return value <= operand
      }
      if (typeof value === 'string' && typeof operand === 'string') {
        return value <= operand
      }
      return false

    case 'like':
      if (typeof value !== 'string' || typeof operand !== 'string') return false
      // Convert SQL LIKE pattern to regex
      const likePattern = operand.replace(/%/g, '.*').replace(/_/g, '.')
      return new RegExp(`^${likePattern}$`, 'i').test(value)

    case 'contains':
      if (typeof value !== 'string' || typeof operand !== 'string') return false
      return value.toLowerCase().includes(operand.toLowerCase())

    case 'exists':
      const fieldExists = value !== undefined && value !== null
      return operand === true ? fieldExists : !fieldExists

    default:
      return true
  }
}

// ============================================================================
// SORTING HELPERS
// ============================================================================

/**
 * Sort results by sort string
 */
function sortResults(results: ThingData[], sort: string): ThingData[] {
  const isDesc = sort.startsWith('-')
  const field = isDesc ? sort.slice(1) : sort
  const direction = isDesc ? -1 : 1

  return [...results].sort((a, b) => {
    const aVal = getFieldValue(a, field)
    const bVal = getFieldValue(b, field)

    // Handle null/undefined (sort to end)
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return 1
    if (bVal == null) return -1

    // Compare dates
    if (aVal instanceof Date && bVal instanceof Date) {
      return (aVal.getTime() - bVal.getTime()) * direction
    }

    // Compare numbers
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * direction
    }

    // Compare strings
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal) * direction
    }

    return 0
  })
}

// ============================================================================
// TRANSFORMATION HELPERS
// ============================================================================

/**
 * Transform context for Thing to Payload conversion
 */
interface TransformContext {
  collection: string
  namespace: string
}

/**
 * Transform a Thing to a Payload document
 */
function transformThingToPayload(thing: ThingData, ctx: TransformContext): Record<string, unknown> {
  const id = thing.$id?.split('/').pop()

  return {
    id,
    ...thing.data,
    createdAt: thing.createdAt instanceof Date ? thing.createdAt.toISOString() : thing.createdAt,
    updatedAt: thing.updatedAt instanceof Date ? thing.updatedAt.toISOString() : thing.updatedAt,
  }
}

// ============================================================================
// RELATIONSHIP POPULATION
// ============================================================================

/**
 * Populate relationships in a document
 */
async function populateRelationships(
  doc: Record<string, unknown>,
  depth: number,
  collection: string,
  ctx: FindContext
): Promise<Record<string, unknown>> {
  if (depth <= 0) return doc

  const { namespace, things, relationships, schemas } = ctx
  const schema = schemas?.get(collection) || ctx.schema

  if (!schema) return doc

  const result = { ...doc }

  for (const field of schema) {
    if (field.type === 'relationship' || field.type === 'upload') {
      const fieldValue = doc[field.name]
      if (fieldValue == null) continue

      const relationTo = field.relationTo

      // Handle polymorphic relationships (relationTo is array)
      if (Array.isArray(relationTo)) {
        // Value should be { relationTo: 'collection', value: 'id' }
        if (typeof fieldValue === 'object' && fieldValue !== null && 'relationTo' in fieldValue && 'value' in fieldValue) {
          const polyValue = fieldValue as { relationTo: string; value: string }
          const relatedDoc = await resolveRelatedDocument(
            polyValue.value,
            polyValue.relationTo,
            depth - 1,
            ctx
          )
          if (relatedDoc) {
            result[field.name] = {
              relationTo: polyValue.relationTo,
              value: relatedDoc,
            }
          }
        }
        continue
      }

      // Handle hasMany relationships (array of IDs)
      if (field.hasMany && Array.isArray(fieldValue)) {
        const relatedDocs = await Promise.all(
          fieldValue.map((id) => resolveRelatedDocument(String(id), relationTo || '', depth - 1, ctx))
        )
        result[field.name] = relatedDocs.filter((d) => d !== null)
        continue
      }

      // Handle single relationships
      const relatedDoc = await resolveRelatedDocument(String(fieldValue), relationTo || '', depth - 1, ctx)
      if (relatedDoc) {
        result[field.name] = relatedDoc
      }
    }
  }

  return result
}

/**
 * Resolve a related document by ID and collection
 */
async function resolveRelatedDocument(
  id: string,
  collection: string,
  depth: number,
  ctx: FindContext
): Promise<Record<string, unknown> | null> {
  const { namespace, things, schemas } = ctx
  const thingId = `${namespace}/${collection}/${id}`
  const thing = things.get(thingId)

  if (!thing) return null

  const doc = transformThingToPayload(thing, { collection, namespace })

  if (depth > 0) {
    // Create a context with the related collection's schema
    const relatedSchema = schemas?.get(collection)
    return populateRelationships(doc, depth, collection, { ...ctx, schema: relatedSchema })
  }

  return doc
}
