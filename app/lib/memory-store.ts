/**
 * In-Memory Store for TanStack Start App
 *
 * Provides a simple in-memory data store for the REST API routes.
 * Used for development and E2E testing where a full database isn't needed.
 */

import type { ThingEntity } from '../../db/stores'

// In-memory storage
const store = new Map<string, ThingEntity>()

// Initialize with some seed data
function initializeStore() {
  if (store.size > 0) return

  // Add seed customers
  const customers = [
    { id: 'alice', name: 'Alice Smith', email: 'alice@example.com' },
    { id: 'bob', name: 'Bob Jones', email: 'bob@example.com' },
    { id: 'charlie', name: 'Charlie Brown', email: 'charlie@example.com' },
  ]

  for (const customer of customers) {
    store.set(`Customer:${customer.id}`, {
      $id: customer.id,
      $type: 'Customer',
      name: customer.name,
      data: { email: customer.email },
    })
  }

  // Add seed products
  const products = [
    { id: 'widget', name: 'Widget', price: 9.99 },
    { id: 'gadget', name: 'Gadget', price: 19.99 },
  ]

  for (const product of products) {
    store.set(`Product:${product.id}`, {
      $id: product.id,
      $type: 'Product',
      name: product.name,
      data: { price: product.price },
    })
  }
}

// Ensure store is initialized
initializeStore()

/**
 * In-memory ThingsStore compatible interface
 */
export const memoryStore = {
  async get(type: string, id: string): Promise<ThingEntity | null> {
    initializeStore()
    return store.get(`${type}:${id}`) ?? null
  },

  async list(type: string): Promise<ThingEntity[]> {
    initializeStore()
    const results: ThingEntity[] = []
    store.forEach((value, key) => {
      if (key.startsWith(`${type}:`)) {
        results.push(value)
      }
    })
    return results
  },

  async count(type: string): Promise<number> {
    initializeStore()
    let count = 0
    store.forEach((_, key) => {
      if (key.startsWith(`${type}:`)) {
        count++
      }
    })
    return count
  },

  async create(type: string, data: Partial<ThingEntity>): Promise<ThingEntity> {
    initializeStore()
    const id = data.$id ?? crypto.randomUUID()
    const entity: ThingEntity = {
      $id: id,
      $type: type,
      name: data.name ?? null,
      data: data.data ?? null,
    }
    store.set(`${type}:${id}`, entity)
    return entity
  },

  async update(type: string, id: string, data: Partial<ThingEntity>): Promise<ThingEntity> {
    initializeStore()
    const existing = store.get(`${type}:${id}`)
    if (!existing) {
      throw new Error(`${type} not found: ${id}`)
    }
    const updated: ThingEntity = {
      ...existing,
      name: data.name ?? existing.name,
      data: data.data ?? existing.data,
    }
    store.set(`${type}:${id}`, updated)
    return updated
  },

  async delete(type: string, id: string): Promise<void> {
    initializeStore()
    const key = `${type}:${id}`
    if (!store.has(key)) {
      throw new Error(`${type} not found: ${id}`)
    }
    store.delete(key)
  },

  // Get all registered types
  getTypes(): string[] {
    initializeStore()
    const types = new Set<string>()
    store.forEach((_, key) => {
      const [type] = key.split(':')
      if (type) types.add(type)
    })
    return Array.from(types)
  },
}

/**
 * Get plural form of a type name
 */
export function pluralize(type: string): string {
  if (type.endsWith('y')) {
    return type.slice(0, -1) + 'ies'
  }
  if (type.endsWith('s') || type.endsWith('x') || type.endsWith('ch') || type.endsWith('sh')) {
    return type + 'es'
  }
  return type + 's'
}

/**
 * Get singular form of a plural type name
 */
export function singularize(plural: string): string {
  if (plural.endsWith('ies')) {
    return plural.slice(0, -3) + 'y'
  }
  if (plural.endsWith('es')) {
    return plural.slice(0, -2)
  }
  if (plural.endsWith('s')) {
    return plural.slice(0, -1)
  }
  return plural
}

/**
 * Capitalize first letter
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
