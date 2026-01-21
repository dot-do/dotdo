// Things CRUD - see do-7rf.4.1
// Generic types added per do-jqrj
// Storage abstraction added per do-68rr
// Branded types added per do-e3my

import type { StorableData, JsonValue } from './types'
import type { StorageAdapter } from './storage'
import type { ThingId } from './branded-types'
import { toThingId } from './branded-types'
import { generateId } from './id'

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
 * ThingsStore interface with generic type parameter
 * T defaults to StorableData for backward compatibility
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
 * Create a ThingsStore backed by a StorageAdapter
 * This allows using any storage backend (SQLite, memory, etc.)
 */
export function createThingsStoreWithAdapter<T extends StorableData = StorableData>(
  adapter: StorageAdapter
): ThingsStore<T> {
  return {
    async create(data) {
      if (!data.$type) {
        throw new Error('$type is required')
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

    async update(id, data) {
      const existing = await adapter.get<Thing<T>>(`${THINGS_PREFIX}${id}`)
      if (!existing) {
        throw new Error(`Thing not found: ${id}`)
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
        throw new Error(`Thing not found: ${id}`)
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

    async bulkCreate(items) {
      if (items.length === 0) {
        return []
      }

      // Validate all items first
      for (const data of items) {
        if (!data.$type) {
          throw new Error('$type is required')
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
          throw new Error(`Thing not found: ${id}`)
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
          throw new Error(`Thing not found: ${id}`)
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
        throw new Error('$type is required')
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

    async update(id, data) {
      const thingId = toThingId(id)
      const existing = things.get(thingId)
      if (!existing) {
        throw new Error(`Thing not found: ${id}`)
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
        throw new Error(`Thing not found: ${id}`)
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

    async bulkCreate(items) {
      if (items.length === 0) {
        return []
      }

      // Validate all items first (atomic: fail before any changes)
      for (const data of items) {
        if (!data.$type) {
          throw new Error('$type is required')
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
          throw new Error(`Thing not found: ${id}`)
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
          throw new Error(`Thing not found: ${id}`)
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
