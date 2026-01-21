/**
 * @dotdo/db - Relationships Store
 *
 * RelationshipsStore provides storage for subject-predicate-object triples,
 * enabling graph-like relationships between entities.
 *
 * @module @dotdo/db/relationships
 */

import type { StorableData, JsonValue } from './types'
import type { StorageAdapter } from './storage'
import type { ThingId } from './branded-types'
import type { CursorPaginationOptions, CursorPaginatedResult } from './pagination'
import { applyCursorPagination } from './pagination'

/**
 * Base Relationship interface with system fields
 * Uses branded ThingId for subject/object for type safety - see do-e3my
 */
export interface BaseRelationship {
  subject: ThingId | string    // Thing $id (accepts both for backward compat)
  predicate: string  // Verb (e.g., "owns", "created", "belongsTo")
  object: ThingId | string     // Thing $id (accepts both for backward compat)
  $createdAt: number
}

/**
 * Relationship type combining system fields with custom metadata
 * Use Relationship<M> for typed relationship metadata
 */
export type Relationship<M extends StorableData = StorableData> = BaseRelationship & M

/**
 * Input type for adding a Relationship (excludes auto-generated fields)
 */
export type RelationshipInput<M extends StorableData = StorableData> =
  Omit<BaseRelationship, '$createdAt'> & M

/**
 * Query type for finding relationships (core fields only)
 */
export type RelationshipQuery = Partial<Pick<BaseRelationship, 'subject' | 'predicate' | 'object'>>

/**
 * Query options for cursor-based pagination
 */
export interface RelationshipCursorQueryOptions extends CursorPaginationOptions {
  subject?: ThingId | string
  predicate?: string
  object?: ThingId | string
}

/**
 * RelationshipsStore interface for subject-predicate-object triples.
 *
 * Provides operations for creating and querying graph-like relationships
 * between entities using the semantic triple pattern (subject, predicate, object).
 *
 * @template M - Optional metadata type for relationships, defaults to StorableData
 *
 * @example
 * ```typescript
 * // Create a relationship
 * await relationships.add({
 *   subject: customerId,
 *   predicate: 'owns',
 *   object: orderId
 * })
 *
 * // Find relationships
 * const orders = await relationships.find({
 *   subject: customerId,
 *   predicate: 'owns'
 * })
 *
 * // Get related entities (convenience method)
 * const orderIds = await relationships.getRelated(customerId, 'owns')
 *
 * // Get reverse relationships
 * const customerIds = await relationships.getRelatedTo(orderId, 'owns')
 * ```
 */
export interface RelationshipsStore<M extends StorableData = StorableData> {
  /**
   * Add a new relationship between entities.
   * @param rel - Relationship with subject, predicate, object, and optional metadata
   * @returns The created relationship with timestamp
   * @throws Error if relationship already exists
   */
  add(rel: RelationshipInput<M>): Promise<Relationship<M>>

  /**
   * Remove a relationship.
   * @param rel - The relationship to remove (subject, predicate, object)
   * @throws Error if relationship not found
   */
  remove(rel: Pick<BaseRelationship, 'subject' | 'predicate' | 'object'>): Promise<void>

  /**
   * Find relationships matching a query.
   * @param query - Filter by subject, predicate, and/or object
   * @returns Array of matching relationships
   */
  find(query: RelationshipQuery): Promise<Relationship<M>[]>

  /**
   * Find relationships with cursor-based pagination.
   * @param options - Query options with cursor support
   * @returns Paginated result with items and cursor info
   */
  findWithCursor(options?: RelationshipCursorQueryOptions): Promise<CursorPaginatedResult<Relationship<M>>>

  /**
   * Get object IDs related to a subject by a predicate.
   * Convenience method equivalent to find({subject, predicate}).map(r => r.object)
   *
   * @param subjectId - The subject entity ID (accepts ThingId or string for backward compatibility)
   * @param predicate - The relationship type (verb)
   * @returns Array of related object IDs
   */
  getRelated(subjectId: ThingId | string, predicate: string): Promise<string[]>

  /**
   * Get subject IDs that are related to an object by a predicate.
   * Reverse of getRelated - finds who points to the object.
   *
   * @param objectId - The object entity ID (accepts ThingId or string for backward compatibility)
   * @param predicate - The relationship type (verb)
   * @returns Array of subject IDs that have this relationship
   */
  getRelatedTo(objectId: ThingId | string, predicate: string): Promise<string[]>
}

/**
 * Key prefix for relationships in storage adapter
 */
const RELATIONSHIPS_PREFIX = 'rel:'

/**
 * Generate a deterministic key for a relationship
 */
function relationshipKey(rel: Pick<BaseRelationship, 'subject' | 'predicate' | 'object'>): string {
  // Use a deterministic key based on the triple
  return `${RELATIONSHIPS_PREFIX}${rel.subject}:${rel.predicate}:${rel.object}`
}

/**
 * Create a RelationshipsStore backed by a StorageAdapter.
 *
 * This factory function creates a RelationshipsStore that can use any storage backend
 * (SQLite, memory, etc.) via the adapter pattern.
 *
 * @template M - Optional metadata type for relationships
 * @param adapter - The storage adapter to use for persistence
 * @returns A fully-functional RelationshipsStore instance
 *
 * @example
 * ```typescript
 * import { createRelationshipsStoreWithAdapter, createSQLiteAdapter } from '@dotdo/db'
 *
 * const adapter = createSQLiteAdapter(sql)
 * const relationships = createRelationshipsStoreWithAdapter(adapter)
 *
 * await relationships.add({
 *   subject: customerId,
 *   predicate: 'owns',
 *   object: orderId
 * })
 * ```
 */
export function createRelationshipsStoreWithAdapter<M extends StorableData = StorableData>(
  adapter: StorageAdapter
): RelationshipsStore<M> {
  return {
    async add(rel) {
      const key = relationshipKey(rel)

      // Check for duplicate
      const existing = await adapter.has(key)
      if (existing) {
        throw new Error('Relationship already exists')
      }

      const relationship = {
        ...rel,
        $createdAt: Date.now()
      } as Relationship<M>

      await adapter.put(key, relationship)
      return relationship
    },

    async remove(rel) {
      const key = relationshipKey(rel)

      const exists = await adapter.has(key)
      if (!exists) {
        throw new Error('Relationship not found')
      }

      await adapter.delete(key)
    },

    async find(query) {
      const result = await adapter.list<Relationship<M>>({ prefix: RELATIONSHIPS_PREFIX, includeValues: true })
      let relationships = Array.from(result.entries.values()).filter((r): r is Relationship<M> => r !== undefined)

      // Apply filters
      return relationships.filter(r => {
        if (query.subject && r.subject !== query.subject) return false
        if (query.predicate && r.predicate !== query.predicate) return false
        if (query.object && r.object !== query.object) return false
        return true
      })
    },

    async findWithCursor(options = {}) {
      const { subject, predicate, object, cursor, limit = 100, direction = 'forward' } = options

      const result = await adapter.list<Relationship<M>>({ prefix: RELATIONSHIPS_PREFIX, includeValues: true })
      let relationships = Array.from(result.entries.values()).filter((r): r is Relationship<M> => r !== undefined)

      // Apply filters
      relationships = relationships.filter(r => {
        if (subject && r.subject !== subject) return false
        if (predicate && r.predicate !== predicate) return false
        if (object && r.object !== object) return false
        return true
      })

      // Sort by createdAt descending, then by composite ID for stable ordering
      const getRelId = (rel: Relationship<M>) => `${rel.subject}:${rel.predicate}:${rel.object}`
      relationships.sort((a, b) => {
        const timeDiff = b.$createdAt - a.$createdAt
        if (timeDiff !== 0) return timeDiff
        return getRelId(b).localeCompare(getRelId(a))
      })

      return applyCursorPagination(
        relationships,
        { cursor, limit, direction },
        '$createdAt',
        'desc',
        // Generate a unique ID from the triple
        getRelId,
        (rel) => rel.$createdAt
      )
    },

    async getRelated(subjectId, predicate) {
      const rels = await this.find({ subject: subjectId, predicate })
      return rels.map(r => r.object as string)
    },

    async getRelatedTo(objectId, predicate) {
      const rels = await this.find({ object: objectId, predicate })
      return rels.map(r => r.subject as string)
    }
  }
}

/**
 * Create an in-memory RelationshipsStore for testing or simple use cases.
 *
 * This implementation stores all data in memory and does not persist across restarts.
 * For production use, prefer createRelationshipsStoreWithAdapter with a SQLite adapter.
 *
 * @template M - Optional metadata type for relationships
 * @returns An in-memory RelationshipsStore instance
 *
 * @example
 * ```typescript
 * import { createRelationshipsStore } from '@dotdo/db'
 *
 * // For testing
 * const relationships = createRelationshipsStore()
 * await relationships.add({
 *   subject: 'user-1',
 *   predicate: 'follows',
 *   object: 'user-2'
 * })
 * ```
 */
export function createRelationshipsStore<M extends StorableData = StorableData>(): RelationshipsStore<M> {
  const relationships: Relationship<M>[] = []

  const findIndex = (rel: Pick<BaseRelationship, 'subject' | 'predicate' | 'object'>) => {
    return relationships.findIndex(
      r => r.subject === rel.subject &&
           r.predicate === rel.predicate &&
           r.object === rel.object
    )
  }

  return {
    async add(rel) {
      // Check for duplicate
      if (findIndex(rel) !== -1) {
        throw new Error('Relationship already exists')
      }

      const relationship = {
        ...rel,
        $createdAt: Date.now()
      } as Relationship<M>

      relationships.push(relationship)
      return relationship
    },

    async remove(rel) {
      const index = findIndex(rel)
      if (index === -1) {
        throw new Error('Relationship not found')
      }
      relationships.splice(index, 1)
    },

    async find(query) {
      return relationships.filter(r => {
        if (query.subject && r.subject !== query.subject) return false
        if (query.predicate && r.predicate !== query.predicate) return false
        if (query.object && r.object !== query.object) return false
        return true
      })
    },

    async findWithCursor(options = {}) {
      const { subject, predicate, object, cursor, limit = 100, direction = 'forward' } = options

      let results = relationships.filter(r => {
        if (subject && r.subject !== subject) return false
        if (predicate && r.predicate !== predicate) return false
        if (object && r.object !== object) return false
        return true
      })

      // Sort by createdAt descending, then by composite ID for stable ordering
      const getRelId = (rel: Relationship<M>) => `${rel.subject}:${rel.predicate}:${rel.object}`
      results.sort((a, b) => {
        const timeDiff = b.$createdAt - a.$createdAt
        if (timeDiff !== 0) return timeDiff
        return getRelId(b).localeCompare(getRelId(a))
      })

      return applyCursorPagination(
        results,
        { cursor, limit, direction },
        '$createdAt',
        'desc',
        // Generate a unique ID from the triple
        getRelId,
        (rel) => rel.$createdAt
      )
    },

    async getRelated(subjectId, predicate) {
      const rels = await this.find({ subject: subjectId, predicate })
      return rels.map(r => r.object as string)
    },

    async getRelatedTo(objectId, predicate) {
      const rels = await this.find({ object: objectId, predicate })
      return rels.map(r => r.subject as string)
    }
  }
}
