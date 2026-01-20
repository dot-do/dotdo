// Things CRUD - see do-7rf.4.1
// Generic types added per do-jqrj

import type { StorableData, JsonValue } from './types'

/**
 * Base Thing interface with system fields
 * T extends StorableData for user-defined properties
 */
export interface BaseThing {
  $id: string
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
 */
export interface BulkUpdateItem<T extends StorableData = StorableData> {
  id: string
  data: ThingUpdate<T>
}

/**
 * ThingsStore interface with generic type parameter
 * T defaults to StorableData for backward compatibility
 */
export interface ThingsStore<T extends StorableData = StorableData> {
  create<D extends Partial<T> & { $type: string }>(data: D): Promise<Thing<T> & D>
  get(id: string): Promise<Thing<T> | null>
  update<U extends ThingUpdate<T>>(id: string, data: U): Promise<Thing<T>>
  delete(id: string): Promise<void>
  list(options?: { type?: string; limit?: number; offset?: number }): Promise<Thing<T>[]>
  bulkCreate<D extends Partial<T> & { $type: string }>(things: D[]): Promise<(Thing<T> & D)[]>
  bulkUpdate(items: BulkUpdateItem<T>[]): Promise<Thing<T>[]>
  bulkDelete(ids: string[]): Promise<void>
}

// Generate unique ID
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// In-memory implementation (SQLite in do-7rf.4.6)
export function createThingsStore(): ThingsStore {
  const things = new Map<string, Thing>()

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
      return things.get(id) ?? null
    },

    async update(id, data) {
      const existing = things.get(id)
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

      things.set(id, updated)
      return updated
    },

    async delete(id) {
      if (!things.has(id)) {
        throw new Error(`Thing not found: ${id}`)
      }
      things.delete(id)
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
        if (!things.has(id)) {
          throw new Error(`Thing not found: ${id}`)
        }
      }

      // All valid, now update them
      const now = Date.now()
      const updated: Thing[] = []

      for (const { id, data } of items) {
        const existing = things.get(id)!
        const updatedThing: Thing = {
          ...existing,
          ...data,
          $id: existing.$id,
          $type: existing.$type,
          $createdAt: existing.$createdAt,
          $updatedAt: now,
        }
        things.set(id, updatedThing)
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
        if (!things.has(id)) {
          throw new Error(`Thing not found: ${id}`)
        }
      }

      // All valid, now delete them
      for (const id of ids) {
        things.delete(id)
      }
    }
  }
}
