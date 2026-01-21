// Things CRUD - see do-7rf.4.1
// Generic types added per do-jqrj
// Storage abstraction added per do-68rr
// Branded types added per do-e3my
// Input validation added per do-c8s8

import type { StorableData, JsonValue } from './types'
import type { StorageAdapter } from './storage'
import type { ThingId } from './branded-types'
import { toThingId } from './branded-types'
import { generateId } from './id'
import { DbNotFoundError } from './errors'
import {
  validateThingInput,
  validateThingUpdate,
  validateId,
  validateIds,
  validateListOptions,
  validateBulkUpdateItems
} from './validation'

/**
 * Base Thing interface with system fields.
 * T extends StorableData for user-defined properties
 * Uses branded ThingId for type safety - see do-e3my
 *
 * @stable
 * @since 1.0.0
 */
export interface BaseThing {
  $id: ThingId
  $type: string
  $createdAt: number
  $updatedAt: number
}

/**
 * Thing type combining system fields with user data.
 * Use Thing<T> for typed entity storage
 *
 * @stable
 * @since 1.0.0
 */
export type Thing<T extends StorableData = StorableData> = BaseThing & T

/**
 * Input type for creating a Thing (excludes auto-generated fields)
 */
export type ThingInput<T extends StorableData = StorableData> =
  Omit<BaseThing, '$id' | '$createdAt' | '$updatedAt'> & T

/**
 * Input type for updating a Thing (excludes immutable fields)
 */
export type ThingUpdate<T extends StorableData = StorableData> =
  Partial<Omit<T, '$id' | '$type'>>

/**
 * Bulk update item with generic support
 * Uses branded ThingId for type safety
 */
export interface BulkUpdateItem<T extends StorableData = StorableData> {
  id: ThingId | string  // Accept both for backward compatibility
  data: ThingUpdate<T>
}

/**
 * Cursor-based pagination result
 */
export interface CursorResult<T> {
  items: T[]
  cursor?: string
  hasMore: boolean
}

/**
 * Options for cursor-based pagination
 */
export interface CursorOptions {
  cursor?: string
  limit?: number
  type?: string
}

/**
 * ThingsStore interface with generic type parameter.
 * T defaults to StorableData for backward compatibility
 *
 * @stable
 * @since 1.0.0
 */
export interface ThingsStore<T extends StorableData = StorableData> {
  create<D extends Partial<T> & { $type: string }>(data: D): Promise<Thing<T> & D>
  get(id: string): Promise<Thing<T> | null>
  getMany?(ids: string[]): Promise<Map<string, Thing<T>>>
  update<U extends ThingUpdate<T>>(id: string, data: U): Promise<Thing<T>>
  delete(id: string): Promise<void>
  list(options?: { type?: string; limit?: number; offset?: number }): Promise<Thing<T>[]>
  listWithCursor?(options?: CursorOptions): Promise<CursorResult<Thing<T>>>
  bulkCreate<D extends Partial<T> & { $type: string }>(things: D[]): Promise<(Thing<T> & D)[]>
  bulkUpdate(items: BulkUpdateItem<T>[]): Promise<Thing<T>[]>
  bulkDelete(ids: string[]): Promise<void>
}

// ID generation moved to ./id.ts (do-y5ko)

/**
 * Key prefix for things in storage adapter
 */
const THINGS_PREFIX = 'thing:'

/**
 * Create a ThingsStore backed by a StorageAdapter.
 * This allows using any storage backend (SQLite, memory, etc.)
 *
 * @stable
 * @since 1.0.0
 */
export function createThingsStoreWithAdapter<T extends StorableData = StorableData>(
  adapter: StorageAdapter
): ThingsStore<T> {
  return {
    async create(data) {
      // Validate input data (do-c8s8)
      validateThingInput(data)

      const now = Date.now()
      const id = generateId()

      const thing = {
        ...data,
        $id: id,
        $createdAt: now,
        $updatedAt: now,
      } as unknown as Thing<T>

      await adapter.put(`${THINGS_PREFIX}${id}`, thing)
      return thing as Thing<T> & typeof data
    },

    async get(id) {
      // Validate ID (do-c8s8)
      validateId(id, '$id')
      const thing = await adapter.get<Thing<T>>(`${THINGS_PREFIX}${id}`)
      return thing ?? null
    },

    async update(id, data) {
      // Validate ID and update data (do-c8s8)
      validateId(id, '$id')
      validateThingUpdate(data)

      const existing = await adapter.get<Thing<T>>(`${THINGS_PREFIX}${id}`)
      if (!existing) {
        throw DbNotFoundError.forResource('Thing', id)
      }

      const updated: Thing<T> = {
        ...existing,
        ...data,
        $id: existing.$id,
        $type: existing.$type,
        $createdAt: existing.$createdAt,
        $updatedAt: Date.now(),
      }

      await adapter.put(`${THINGS_PREFIX}${id}`, updated)
      return updated
    },

    async delete(id) {
      // Validate ID (do-c8s8)
      validateId(id, '$id')
      const exists = await adapter.has(`${THINGS_PREFIX}${id}`)
      if (!exists) {
        throw DbNotFoundError.forResource('Thing', id)
      }
      await adapter.delete(`${THINGS_PREFIX}${id}`)
    },

    async list(options = {}) {
      // Validate list options (do-c8s8)
      const validated = validateListOptions(options)
      const { type, limit = 100, offset = 0 } = validated

      const result = await adapter.list<Thing<T>>({ prefix: THINGS_PREFIX, includeValues: true })
      let items = Array.from(result.entries.values()).filter((t): t is Thing<T> => t !== undefined)

      if (type) {
        items = items.filter(t => t.$type === type)
      }

      // Sort by createdAt descending
      items.sort((a, b) => b.$createdAt - a.$createdAt)

      return items.slice(offset, offset + limit)
    },

    async bulkCreate(items) {
      if (items.length === 0) {
        return []
      }

      // Validate all items first (do-c8s8)
      for (const data of items) {
        validateThingInput(data)
      }

      const now = Date.now()
      const created: (Thing<T> & typeof items[number])[] = []
      const entries = new Map<string, Thing<T>>()

      for (const data of items) {
        const id = generateId()
        const thing = {
          ...data,
          $id: id,
          $createdAt: now,
          $updatedAt: now,
        } as Thing<T> & typeof data
        entries.set(`${THINGS_PREFIX}${id}`, thing)
        created.push(thing)
      }

      await adapter.putMany(entries)
      return created
    },

    async bulkUpdate(items) {
      if (items.length === 0) {
        return []
      }

      // Validate all items (do-c8s8)
      const validatedItems = validateBulkUpdateItems<T>(items)

      // Get all existing items first
      const keys = validatedItems.map(({ id }) => `${THINGS_PREFIX}${id}`)
      const existingMap = await adapter.getMany<Thing<T>>(keys)

      // Validate all items exist
      for (const { id } of validatedItems) {
        if (!existingMap.has(`${THINGS_PREFIX}${id}`)) {
          throw DbNotFoundError.forResource('Thing', id)
        }
      }

      const now = Date.now()
      const updated: Thing<T>[] = []
      const entries = new Map<string, Thing<T>>()

      for (const { id, data } of validatedItems) {
        const existing = existingMap.get(`${THINGS_PREFIX}${id}`)!
        const updatedThing: Thing<T> = {
          ...existing,
          ...data,
          $id: existing.$id,
          $type: existing.$type,
          $createdAt: existing.$createdAt,
          $updatedAt: now,
        }
        entries.set(`${THINGS_PREFIX}${id}`, updatedThing)
        updated.push(updatedThing)
      }

      await adapter.putMany(entries)
      return updated
    },

    async bulkDelete(ids) {
      if (ids.length === 0) {
        return
      }

      // Validate all IDs (do-c8s8)
      const validatedIds = validateIds(ids, 'ids')

      // Validate all items exist first
      const keys = validatedIds.map(id => `${THINGS_PREFIX}${id}`)
      const existingMap = await adapter.getMany(keys)

      for (const id of validatedIds) {
        if (!existingMap.has(`${THINGS_PREFIX}${id}`)) {
          throw DbNotFoundError.forResource('Thing', id)
        }
      }

      await adapter.deleteMany(keys)
    }
  }
}

/**
 * In-memory implementation of ThingsStore.
 * Uses internal Map for storage.
 *
 * @deprecated Use createThingsStoreWithAdapter() with a storage adapter instead.
 *             This in-memory implementation will be removed in v4.0.0.
 * @since 1.0.0
 * @see {@link createThingsStoreWithAdapter} for the recommended alternative
 *
 * ## Migration Guide
 *
 * ### For Testing (In-Memory Storage)
 *
 * If you were using `createThingsStore()` for testing with in-memory storage,
 * migrate to `createThingsStoreWithAdapter()` with `MemoryStorageAdapter`:
 *
 * ```typescript
 * // Before (deprecated)
 * import { createThingsStore } from '@dotdo/db'
 * const store = createThingsStore()
 *
 * // After (recommended)
 * import { createThingsStoreWithAdapter, MemoryStorageAdapter } from '@dotdo/db'
 * const adapter = new MemoryStorageAdapter()
 * const store = createThingsStoreWithAdapter(adapter)
 * ```
 *
 * ### For Production (SQLite Storage)
 *
 * For production use with Durable Objects, use SQLite storage:
 *
 * ```typescript
 * // In a Durable Object class
 * import { createThingsStoreWithAdapter, createSQLiteStorageAdapter } from '@dotdo/db'
 *
 * class MyDO {
 *   private things: ThingsStore
 *
 *   constructor(state: DurableObjectState) {
 *     const adapter = createSQLiteStorageAdapter(state.storage.sql)
 *     this.things = createThingsStoreWithAdapter(adapter)
 *   }
 * }
 * ```
 *
 * ### Shared Storage for Multiple Stores
 *
 * When using multiple stores (Things, Events, Relationships), share the adapter:
 *
 * ```typescript
 * import {
 *   createThingsStoreWithAdapter,
 *   createEventsStoreWithAdapter,
 *   createRelationshipsStoreWithAdapter,
 *   MemoryStorageAdapter
 * } from '@dotdo/db'
 *
 * // Create one adapter, share across stores
 * const adapter = new MemoryStorageAdapter()
 * const things = createThingsStoreWithAdapter(adapter)
 * const events = createEventsStoreWithAdapter(adapter)
 * const relationships = createRelationshipsStoreWithAdapter(adapter)
 * ```
 *
 * ### Benefits of Migration
 *
 * - **Pluggable Storage**: Swap storage backends without changing business logic
 * - **SQLite Support**: Full SQLite support for Durable Objects
 * - **Transaction Support**: Atomic operations via `adapter.transaction()`
 * - **Shared Adapters**: Multiple stores can share one adapter for consistency
 * - **Namespacing**: Isolate data with adapter namespaces
 *
 * @removal v4.0.0
 */
export function createThingsStore(): ThingsStore {
  // Runtime deprecation warning
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      '[DEPRECATION] createThingsStore() is deprecated and will be removed in v4.0.0. ' +
      'Use createThingsStoreWithAdapter() with MemoryStorageAdapter instead. ' +
      'See https://dotdo.dev/docs/migration for details.'
    )
  }

  const things = new Map<ThingId, Thing>()

  return {
    async create(data) {
      // Validate input data (do-c8s8)
      validateThingInput(data)

      const now = Date.now()
      const thing = {
        ...data,
        $id: generateId(),
        $createdAt: now,
        $updatedAt: now,
      } as Thing

      things.set(thing.$id, thing)
      return thing as Thing & typeof data
    },

    async get(id) {
      // Validate ID (do-c8s8)
      validateId(id, '$id')
      const thingId = toThingId(id)
      return things.get(thingId) ?? null
    },

    async update(id, data) {
      // Validate ID and update data (do-c8s8)
      validateId(id, '$id')
      validateThingUpdate(data)

      const thingId = toThingId(id)
      const existing = things.get(thingId)
      if (!existing) {
        throw DbNotFoundError.forResource('Thing', id)
      }

      const updated: Thing = {
        ...existing,
        ...data,
        $id: existing.$id,
        $type: existing.$type,
        $createdAt: existing.$createdAt,
        $updatedAt: Date.now(),
      }

      things.set(thingId, updated)
      return updated
    },

    async delete(id) {
      // Validate ID (do-c8s8)
      validateId(id, '$id')
      const thingId = toThingId(id)
      if (!things.has(thingId)) {
        throw DbNotFoundError.forResource('Thing', id)
      }
      things.delete(thingId)
    },

    async list(options = {}) {
      // Validate list options (do-c8s8)
      const validated = validateListOptions(options)
      const { type, limit = 100, offset = 0 } = validated

      let results = Array.from(things.values())

      if (type) {
        results = results.filter(t => t.$type === type)
      }

      // Sort by createdAt descending
      results.sort((a, b) => b.$createdAt - a.$createdAt)

      return results.slice(offset, offset + limit)
    },

    async bulkCreate(items) {
      if (items.length === 0) {
        return []
      }

      // Validate all items first (atomic: fail before any changes) (do-c8s8)
      for (const data of items) {
        validateThingInput(data)
      }

      // All valid, now create them
      const now = Date.now()
      const created: Thing[] = []

      for (const data of items) {
        const thing = {
          ...data,
          $id: generateId(),
          $createdAt: now,
          $updatedAt: now,
        } as Thing
        things.set(thing.$id, thing)
        created.push(thing)
      }

      return created as (Thing & (typeof items)[number])[]
    },

    async bulkUpdate(items) {
      if (items.length === 0) {
        return []
      }

      // Validate all items (do-c8s8)
      const validatedItems = validateBulkUpdateItems(items)

      // Validate all items exist first (atomic: fail before any changes)
      for (const { id } of validatedItems) {
        const thingId = toThingId(id)
        if (!things.has(thingId)) {
          throw DbNotFoundError.forResource('Thing', id)
        }
      }

      // All valid, now update them
      const now = Date.now()
      const updated: Thing[] = []

      for (const { id, data } of validatedItems) {
        const thingId = toThingId(id)
        const existing = things.get(thingId)!
        const updatedThing: Thing = {
          ...existing,
          ...data,
          $id: existing.$id,
          $type: existing.$type,
          $createdAt: existing.$createdAt,
          $updatedAt: now,
        }
        things.set(thingId, updatedThing)
        updated.push(updatedThing)
      }

      return updated
    },

    async bulkDelete(ids) {
      if (ids.length === 0) {
        return
      }

      // Validate all IDs (do-c8s8)
      const validatedIds = validateIds(ids, 'ids')

      // Validate all items exist first (atomic: fail before any changes)
      for (const id of validatedIds) {
        const thingId = toThingId(id)
        if (!things.has(thingId)) {
          throw DbNotFoundError.forResource('Thing', id)
        }
      }

      // All valid, now delete them
      for (const id of validatedIds) {
        const thingId = toThingId(id)
        things.delete(thingId)
      }
    }
  }
}
