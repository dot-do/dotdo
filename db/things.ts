// Things CRUD - see do-7rf.4.1

export interface Thing {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

export interface ThingsStore {
  create(thing: Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>): Promise<Thing>
  get(id: string): Promise<Thing | null>
  update(id: string, data: Partial<Omit<Thing, '$id' | '$type'>>): Promise<Thing>
  delete(id: string): Promise<void>
  list(options?: { type?: string; limit?: number; offset?: number }): Promise<Thing[]>
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
    }
  }
}
