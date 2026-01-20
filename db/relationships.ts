// Relationships storage - subject-predicate-object triples
// Generic types added per do-jqrj
// Storage abstraction added per do-68rr
// Branded types added per do-e3my
// Cursor-based pagination added per do-rljr.8

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
  subject?: string
  predicate?: string
  object?: string
}

/**
 * RelationshipsStore interface with generic type parameter
 * M defaults to StorableData for backward compatibility
 */
export interface RelationshipsStore<M extends StorableData = StorableData> {
  add(rel: RelationshipInput<M>): Promise<Relationship<M>>
  remove(rel: Pick<BaseRelationship, 'subject' | 'predicate' | 'object'>): Promise<void>
  find(query: RelationshipQuery): Promise<Relationship<M>[]>
  findWithCursor(options?: RelationshipCursorQueryOptions): Promise<CursorPaginatedResult<Relationship<M>>>

  // Convenience methods
  getRelated(subjectId: string, predicate: string): Promise<string[]>
  getRelatedTo(objectId: string, predicate: string): Promise<string[]>
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
 * Create a RelationshipsStore backed by a StorageAdapter
 * This allows using any storage backend (SQLite, memory, etc.)
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
 * Create an in-memory RelationshipsStore with generic type parameter
 * M defaults to StorableData for backward compatibility
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
