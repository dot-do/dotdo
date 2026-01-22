// Things CRUD - see do-7rf.4.1
// Generic types added per do-jqrj
// Storage abstraction added per do-68rr
// Branded types added per do-e3my
// Input validation added per do-c8s8
// Types moved to types.ts per do-stc2d.1 to break circular dependencies

import type { StorableData } from './types'
import { createLogger } from './logger'

// Create a scoped logger for Things store deprecation warnings (using local db logger)
const logger = createLogger('[db/things]')
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
  validateBulkUpdateItems,
  createValidationContext,
  type ValidationContext,
  type ValidationConfig,
} from './validation'
import { applyCursorPagination } from './pagination'
import type { CursorPaginationOptions, CursorPaginatedResult } from './pagination'

// Re-export types from types.ts for backward compatibility
export type {
  BaseThing,
  Thing,
  ThingInput,
  ThingUpdate,
  BulkUpdateItem,
} from './types'

// Import types for local use
import type {
  BaseThing,
  Thing,
  ThingInput,
  ThingUpdate,
  BulkUpdateItem,
} from './types'

/**
 * Cursor-based pagination result
 */
export interface CursorResult<T> {
  items: T[]
  nextCursor?: string
  prevCursor?: string
  hasMore: boolean
}

/**
 * Options for cursor-based pagination
 */
export interface CursorOptions extends CursorPaginationOptions {
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
 * Create a ThingsStore with explicit ValidationContext.
 * This is the recommended approach for context-based validation that avoids global state.
 *
 * @param adapter - The storage adapter to use
 * @param validationContext - Optional validation context (uses default if not provided)
 * @returns A ThingsStore instance with context-based validation
 *
 * @stable
 * @since 3.0.0
 *
 * @example
 * ```typescript
 * import { createThingsStoreWithContext, MemoryStorageAdapter, createValidationContext } from '@dotdo/db'
 *
 * // Create store with custom validation limits
 * const adapter = new MemoryStorageAdapter()
 * const ctx = createValidationContext({
 *   maxStringLength: 100,
 *   maxObjectDepth: 3,
 *   strictIdValidation: true,
 * })
 * const store = createThingsStoreWithContext(adapter, ctx)
 *
 * // Validation uses context-specific config
 * const thing = await store.create({ $type: 'Test', name: 'Alice' })
 * ```
 */
export function createThingsStoreWithContext<T extends StorableData = StorableData>(
  adapter: StorageAdapter,
  validationContext?: ValidationContext
): ThingsStore<T> {
  // Use provided context or create default
  const ctx = validationContext ?? createValidationContext()

  return {
    async create(data) {
      // Validate input data using context
      ctx.validateThingInput(data)

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
      // Validate ID using context
      ctx.validateId(id, '$id')
      const thing = await adapter.get<Thing<T>>(`${THINGS_PREFIX}${id}`)
      return thing ?? null
    },

    async update(id, data) {
      // Validate ID and update data using context
      ctx.validateId(id, '$id')
      ctx.validateThingUpdate(data)

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
      // Validate ID using context
      ctx.validateId(id, '$id')
      const exists = await adapter.has(`${THINGS_PREFIX}${id}`)
      if (!exists) {
        throw DbNotFoundError.forResource('Thing', id)
      }
      await adapter.delete(`${THINGS_PREFIX}${id}`)
    },

    async list(options = {}) {
      // Validate list options using context
      const validated = ctx.validateListOptions(options)
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

      // Validate all items first using context
      for (const data of items) {
        ctx.validateThingInput(data)
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

      // Validate all items using context
      const validatedItems = ctx.validateBulkUpdateItems<T>(items)

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

      // Validate all IDs using context
      const validatedIds = ctx.validateIds(ids, 'ids')

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
  logger.warn(
    '[DEPRECATION] createThingsStore() is deprecated and will be removed in v4.0.0. ' +
    'Use createThingsStoreWithAdapter() with MemoryStorageAdapter instead. ' +
    'See https://dotdo.dev/docs/migration for details.'
  )

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

    async listWithCursor(options = {}) {
      const { type } = options

      let results = Array.from(things.values())

      if (type) {
        results = results.filter(t => t.$type === type)
      }

      // Sort by createdAt descending, then by ID descending for stable ordering
      results.sort((a, b) => {
        const timeDiff = b.$createdAt - a.$createdAt
        if (timeDiff !== 0) return timeDiff
        // Secondary sort by ID descending for stable cursor pagination
        return b.$id.localeCompare(a.$id)
      })

      return applyCursorPagination(
        results,
        options,
        '$createdAt',
        'desc',
        (item) => item.$id,
        (item) => item.$createdAt
      )
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
