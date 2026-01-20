// Things CRUD - see do-7rf.4.1

export interface Thing {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

export interface BulkUpdateItem {
  id: string
  data: Partial<Omit<Thing, '$id' | '$type'>>
}

export interface ThingsStore {
  create(thing: Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>): Promise<Thing>
  get(id: string): Promise<Thing | null>
  update(id: string, data: Partial<Omit<Thing, '$id' | '$type'>>): Promise<Thing>
  delete(id: string): Promise<void>
  list(options?: { type?: string; limit?: number; offset?: number }): Promise<Thing[]>
  bulkCreate(things: Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>[]): Promise<Thing[]>
  bulkUpdate(items: BulkUpdateItem[]): Promise<Thing[]>
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
