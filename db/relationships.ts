// Relationships storage - subject-predicate-object triples
// Generic types added per do-jqrj
// Storage abstraction added per do-68rr
// Branded types added per do-e3my

import type { StorableData, JsonValue } from './types'
import type { StorageAdapter } from './storage'
import type { ThingId } from './branded-types'

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
 * Cursor-based pagination result for relationships
 */
export interface RelationshipCursorResult<M extends StorableData = StorableData> {
  items: Relationship<M>[]
  cursor?: string
  hasMore: boolean
}

/**
 * Options for cursor-based relationship queries
 */
export interface RelationshipCursorOptions extends RelationshipQuery {
  cursor?: string
  limit?: number
  direction?: 'forward' | 'backward'
}

/**
 * RelationshipsStore interface with generic type parameter
 * M defaults to StorableData for backward compatibility
 */
export interface RelationshipsStore<M extends StorableData = StorableData> {
  add(rel: RelationshipInput<M>): Promise<Relationship<M>>
  remove(rel: Pick<BaseRelationship, 'subject' | 'predicate' | 'object'>): Promise<void>
  find(query: RelationshipQuery): Promise<Relationship<M>[]>
  findWithCursor?(options: RelationshipCursorOptions): Promise<RelationshipCursorResult<M>>

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
 * Creates a RelationshipsStore backed by a StorageAdapter.
 *
 * This factory function creates a relationship store that persists relationships
 * using the provided storage adapter. Relationships are subject-predicate-object
 * triples (e.g., "User owns Order", "Order belongsTo Customer").
 *
 * @typeParam M - The metadata type for relationships, defaults to StorableData
 * @param adapter - The storage adapter to use for persistence
 * @returns A RelationshipsStore instance for managing entity relationships
 *
 * @example
 * ```typescript
 * import { createRelationshipsStoreWithAdapter, SQLiteAdapter } from '@dotdo/db'
 *
 * // Create store with SQLite backend
 * const adapter = new SQLiteAdapter(storage)
 * const relationships = createRelationshipsStoreWithAdapter(adapter)
 *
 * // Add a relationship
 * await relationships.add({
 *   subject: 'user-123',
 *   predicate: 'owns',
 *   object: 'order-456'
 * })
 *
 * // Find relationships
 * const userOrders = await relationships.find({ subject: 'user-123', predicate: 'owns' })
 *
 * // Get related object IDs
 * const ownedOrderIds = await relationships.getRelated('user-123', 'owns')
 * // ['order-456', 'order-789', ...]
 *
 * // Get subjects related to an object
 * const orderOwners = await relationships.getRelatedTo('order-456', 'owns')
 * // ['user-123']
 * ```
 *
 * @stable
 * @since 1.0.0
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

    async getRelated(subjectId, predicate) {
      const rels = await this.find({ subject: subjectId, predicate })
      return rels.map(r => r.object)
    },

    async getRelatedTo(objectId, predicate) {
      const rels = await this.find({ object: objectId, predicate })
      return rels.map(r => r.subject)
    }
  }
}

/**
 * Creates an in-memory RelationshipsStore for testing and development.
 *
 * This factory function creates a relationship store backed by in-memory storage.
 * Relationships will be lost when the process ends. Use
 * `createRelationshipsStoreWithAdapter()` with a persistent adapter for production.
 *
 * @typeParam M - The metadata type for relationships, defaults to StorableData
 * @returns A RelationshipsStore instance for managing entity relationships
 *
 * @example
 * ```typescript
 * import { createRelationshipsStore } from '@dotdo/db'
 *
 * const relationships = createRelationshipsStore()
 *
 * // With typed metadata
 * interface RelationshipMeta { createdBy: string; note?: string }
 * const typedRels = createRelationshipsStore<RelationshipMeta>()
 *
 * await typedRels.add({
 *   subject: 'user-123',
 *   predicate: 'follows',
 *   object: 'user-456',
 *   createdBy: 'system',
 *   note: 'Auto-follow on signup'
 * })
 * ```
 *
 * @stable
 * @since 1.0.0
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

    async getRelated(subjectId, predicate) {
      const rels = await this.find({ subject: subjectId, predicate })
      return rels.map(r => r.object)
    },

    async getRelatedTo(objectId, predicate) {
      const rels = await this.find({ object: objectId, predicate })
      return rels.map(r => r.subject)
    }
  }
}
