// Things CRUD - see do-7rf.4.1
// Generic types added per do-jqrj
// Storage abstraction added per do-68rr
// Branded types added per do-e3my
// Cursor-based pagination added per do-rljr.8
// ValidationError support added per do-grp5.7

import type { StorableData, JsonValue } from './types'
import type { StorageAdapter } from './storage'
import type { ThingId } from './branded-types'
import { toThingId } from './branded-types'
import { generateId } from './id'
import type { CursorPaginationOptions, CursorPaginatedResult } from './pagination'
import { applyCursorPagination } from './pagination'
import { ValidationError, NotFoundError } from '@dotdo/rpc/errors'

/**
 * Base Thing interface with system fields
 * T extends StorableData for user-defined properties
 * Uses branded ThingId for type safety - see do-e3my
 */
export interface BaseThing {
  $id: ThingId
  $type: string
  $createdAt: number
  $updatedAt: number
}

/**
 * Thing type combining system fields with user data
 * Use Thing<T> for typed entity storage
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
 * Options for listing things with offset-based pagination
 */
export interface ThingListOptions {
  type?: string
  limit?: number
  offset?: number
}

/**
 * Options for listing things with cursor-based pagination
 */
export interface ThingCursorListOptions extends CursorPaginationOptions {
  type?: string
}

/**
 * ThingsStore interface with generic type parameter
 * T defaults to StorableData for backward compatibility
 */
export interface ThingsStore<T extends StorableData = StorableData> {
  create<D extends Partial<T> & { $type: string }>(data: D): Promise<Thing<T> & D>
  get(id: string): Promise<Thing<T> | null>
  getMany(ids: string[]): Promise<Map<string, Thing<T>>>
  update<U extends ThingUpdate<T>>(id: string, data: U): Promise<Thing<T>>
  delete(id: string): Promise<void>
  list(options?: ThingListOptions): Promise<Thing<T>[]>
  listWithCursor(options?: ThingCursorListOptions): Promise<CursorPaginatedResult<Thing<T>>>
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
 * Create a ThingsStore backed by a StorageAdapter
 * This allows using any storage backend (SQLite, memory, etc.)
 */
export function createThingsStoreWithAdapter<T extends StorableData = StorableData>(
  adapter: StorageAdapter
): ThingsStore<T> {
  return {
    async create(data) {
      if (!data.$type) {
        throw ValidationError.forField('$type', 'is required', undefined)
      }

      if (typeof data.$type !== 'string') {
        throw ValidationError.forField('$type', 'must be a string', typeof data.$type)
      }

      if (data.$type.trim() === '') {
        throw ValidationError.forField('$type', 'cannot be empty', data.$type)
      }

      const now = Date.now()
      const id = generateId()

      const thing = {
        ...data,
        $id: id,
        $createdAt: now,
        $updatedAt: now,
      } as Thing<T>

      await adapter.put(`${THINGS_PREFIX}${id}`, thing)
      return thing as Thing<T> & typeof data
    },

    async get(id) {
      const thing = await adapter.get<Thing<T>>(`${THINGS_PREFIX}${id}`)
      return thing ?? null
    },

    async getMany(ids) {
      if (ids.length === 0) {
        return new Map<string, Thing<T>>()
      }

      const keys = ids.map(id => `${THINGS_PREFIX}${id}`)
      const adapterResult = await adapter.getMany<Thing<T>>(keys)

      // Convert from prefixed keys back to plain IDs
      const result = new Map<string, Thing<T>>()
      for (const [key, value] of adapterResult) {
        const id = key.slice(THINGS_PREFIX.length)
        result.set(id, value)
      }
      return result
    },

    async update(id, data) {
      const existing = await adapter.get<Thing<T>>(`${THINGS_PREFIX}${id}`)
      if (!existing) {
        throw NotFoundError.forResource('Thing', id)
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
      const exists = await adapter.has(`${THINGS_PREFIX}${id}`)
      if (!exists) {
        throw NotFoundError.forResource('Thing', id)
      }
      await adapter.delete(`${THINGS_PREFIX}${id}`)
    },

    async list(options = {}) {
      const { type, limit = 100, offset = 0 } = options

      const result = await adapter.list<Thing<T>>({ prefix: THINGS_PREFIX, includeValues: true })
      let items = Array.from(result.entries.values()).filter((t): t is Thing<T> => t !== undefined)

      if (type) {
        items = items.filter(t => t.$type === type)
      }

      // Sort by createdAt descending
      items.sort((a, b) => b.$createdAt - a.$createdAt)

      return items.slice(offset, offset + limit)
    },

    async listWithCursor(options = {}) {
      const { type, cursor, limit = 100, direction = 'forward' } = options

      const result = await adapter.list<Thing<T>>({ prefix: THINGS_PREFIX, includeValues: true })
      let items = Array.from(result.entries.values()).filter((t): t is Thing<T> => t !== undefined)

      if (type) {
        items = items.filter(t => t.$type === type)
      }

      // Sort by createdAt descending, then by ID descending for stable ordering
      items.sort((a, b) => {
        const timeDiff = b.$createdAt - a.$createdAt
        if (timeDiff !== 0) return timeDiff
        return b.$id.localeCompare(a.$id)
      })

      return applyCursorPagination(
        items,
        { cursor, limit, direction },
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

      // Validate all items first
      for (let i = 0; i < items.length; i++) {
        const data = items[i]
        if (!data.$type) {
          throw ValidationError.forField(`items[${i}].$type`, 'is required', undefined)
        }
        if (typeof data.$type !== 'string') {
          throw ValidationError.forField(`items[${i}].$type`, 'must be a string', typeof data.$type)
        }
        if (data.$type.trim() === '') {
          throw ValidationError.forField(`items[${i}].$type`, 'cannot be empty', data.$type)
        }
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

      // Get all existing items first
      const keys = items.map(({ id }) => `${THINGS_PREFIX}${id}`)
      const existingMap = await adapter.getMany<Thing<T>>(keys)

      // Validate all items exist
      for (const { id } of items) {
        if (!existingMap.has(`${THINGS_PREFIX}${id}`)) {
          throw NotFoundError.forResource('Thing', String(id))
        }
      }

      const now = Date.now()
      const updated: Thing<T>[] = []
      const entries = new Map<string, Thing<T>>()

      for (const { id, data } of items) {
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

      // Validate all items exist first
      const keys = ids.map(id => `${THINGS_PREFIX}${id}`)
      const existingMap = await adapter.getMany(keys)

      for (const id of ids) {
        if (!existingMap.has(`${THINGS_PREFIX}${id}`)) {
          throw NotFoundError.forResource('Thing', id)
        }
      }

      await adapter.deleteMany(keys)
    }
  }
}

// In-memory implementation (SQLite in do-7rf.4.6)
// Kept for backward compatibility - uses internal Map
export function createThingsStore(): ThingsStore {
  const things = new Map<ThingId, Thing>()

  return {
    async create(data) {
      if (!data.$type) {
        throw ValidationError.forField('$type', 'is required', undefined)
      }

      if (typeof data.$type !== 'string') {
        throw ValidationError.forField('$type', 'must be a string', typeof data.$type)
      }

      if (data.$type.trim() === '') {
        throw ValidationError.forField('$type', 'cannot be empty', data.$type)
      }

      const now = Date.now()
      const thing: Thing = {
        ...data,
        $id: generateId(),
        $createdAt: now,
        $updatedAt: now,
      }

      things.set(thing.$id, thing)
      return thing
    },

    async get(id) {
      const thingId = toThingId(id)
      return things.get(thingId) ?? null
    },

    async getMany(ids) {
      const result = new Map<string, Thing>()
      for (const id of ids) {
        const thingId = toThingId(id)
        const thing = things.get(thingId)
        if (thing) {
          result.set(id, thing)
        }
      }
      return result
    },

    async update(id, data) {
      const thingId = toThingId(id)
      const existing = things.get(thingId)
      if (!existing) {
        throw NotFoundError.forResource('Thing', id)
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
      const thingId = toThingId(id)
      if (!things.has(thingId)) {
        throw NotFoundError.forResource('Thing', id)
      }
      things.delete(thingId)
    },

    async list(options = {}) {
      const { type, limit = 100, offset = 0 } = options

      let results = Array.from(things.values())

      if (type) {
        results = results.filter(t => t.$type === type)
      }

      // Sort by createdAt descending
      results.sort((a, b) => b.$createdAt - a.$createdAt)

      return results.slice(offset, offset + limit)
    },

    async listWithCursor(options = {}) {
      const { type, cursor, limit = 100, direction = 'forward' } = options

      let results = Array.from(things.values())

      if (type) {
        results = results.filter(t => t.$type === type)
      }

      // Sort by createdAt descending, then by ID descending for stable ordering
      results.sort((a, b) => {
        const timeDiff = b.$createdAt - a.$createdAt
        if (timeDiff !== 0) return timeDiff
        return b.$id.localeCompare(a.$id)
      })

      return applyCursorPagination(
        results,
        { cursor, limit, direction },
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

      // Validate all items first (atomic: fail before any changes)
      for (let i = 0; i < items.length; i++) {
        const data = items[i]
        if (!data.$type) {
          throw ValidationError.forField(`items[${i}].$type`, 'is required', undefined)
        }
        if (typeof data.$type !== 'string') {
          throw ValidationError.forField(`items[${i}].$type`, 'must be a string', typeof data.$type)
        }
        if (data.$type.trim() === '') {
          throw ValidationError.forField(`items[${i}].$type`, 'cannot be empty', data.$type)
        }
      }

      // All valid, now create them
      const now = Date.now()
      const created: Thing[] = []

      for (const data of items) {
        const thing: Thing = {
          ...data,
          $id: generateId(),
          $createdAt: now,
          $updatedAt: now,
        }
        things.set(thing.$id, thing)
        created.push(thing)
      }

      return created
    },

    async bulkUpdate(items) {
      if (items.length === 0) {
        return []
      }

      // Validate all items exist first (atomic: fail before any changes)
      for (const { id } of items) {
        const thingId = toThingId(id)
        if (!things.has(thingId)) {
          throw NotFoundError.forResource('Thing', String(id))
        }
      }

      // All valid, now update them
      const now = Date.now()
      const updated: Thing[] = []

      for (const { id, data } of items) {
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

      // Validate all items exist first (atomic: fail before any changes)
      for (const id of ids) {
        const thingId = toThingId(id)
        if (!things.has(thingId)) {
          throw NotFoundError.forResource('Thing', id)
        }
      }

      // All valid, now delete them
      for (const id of ids) {
        const thingId = toThingId(id)
        things.delete(thingId)
      }
    }
  }
}
