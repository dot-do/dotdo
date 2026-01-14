/**
 * Resource Abstraction
 *
 * Unified CRUD + Query interface for all database compat layers.
 * Storage-agnostic design: starts with in-memory, designed for D1/DO state.
 */

export type {
  Query,
  QueryOperators,
  ChangeEvent,
  ChangeType,
  ResourceSchema,
  FieldDefinition,
  FieldType,
  Entity,
  Resource,
  StorageBackend,
} from './types'

export { MemoryStorageBackend } from './types'

// Export query utilities
export { matchesQuery } from './query'

import type { Resource, Query, ChangeEvent, ChangeType, ResourceSchema, Entity, StorageBackend } from './types'
import { MemoryStorageBackend } from './types'
import { matchesQuery } from './query'

/**
 * Generate a unique ID for resources
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Type for event listener callback
 */
type EventListener<T> = (event: ChangeEvent<T>) => void

/**
 * Options for creating an InMemoryResource
 */
export interface InMemoryResourceOptions<T extends Entity> {
  schema?: ResourceSchema<T>
  storage?: StorageBackend<T>
}

/**
 * In-memory implementation of the Resource interface
 * Uses a pluggable storage backend (defaults to MemoryStorageBackend)
 */
export class InMemoryResource<T extends Entity> implements Resource<T> {
  private storage: StorageBackend<T>
  private listeners: Set<EventListener<T>> = new Set()
  private _schema: ResourceSchema<T>

  constructor(options?: InMemoryResourceOptions<T>) {
    this.storage = options?.storage ?? new MemoryStorageBackend<T>()
    this._schema = (options?.schema ?? {}) as ResourceSchema<T>
  }

  // =============================================================================
  // Internal Event Emission
  // =============================================================================

  private emit(type: ChangeType, id: string, data?: T, previousData?: T): void {
    const event: ChangeEvent<T> = {
      type,
      id,
      data,
      previousData,
      timestamp: new Date(),
    }
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  // =============================================================================
  // CRUD Operations
  // =============================================================================

  async create(data: Omit<T, 'id'>): Promise<T> {
    const id = generateId()
    const entity = { ...data, id } as T
    await this.storage.set(id, entity)
    this.emit('create', id, entity, undefined)
    return entity
  }

  async get(id: string): Promise<T | null> {
    return this.storage.get(id)
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const existing = await this.storage.get(id)
    if (!existing) {
      throw new Error('Resource not found')
    }
    const updated = { ...existing, ...patch, id } as T
    await this.storage.set(id, updated)
    this.emit('update', id, updated, existing)
    return updated
  }

  async delete(id: string): Promise<void> {
    const existing = await this.storage.get(id)
    if (!existing) {
      throw new Error('Resource not found')
    }
    await this.storage.delete(id)
    this.emit('delete', id, undefined, existing)
  }

  // =============================================================================
  // Query Operations
  // =============================================================================

  async *find(query?: Query<T>): AsyncIterable<T> {
    for await (const entity of this.storage.values()) {
      if (matchesQuery(entity, query)) {
        yield entity
      }
    }
  }

  async findOne(query?: Query<T>): Promise<T | null> {
    for await (const entity of this.storage.values()) {
      if (matchesQuery(entity, query)) {
        return entity
      }
    }
    return null
  }

  async count(query?: Query<T>): Promise<number> {
    let count = 0
    for await (const entity of this.storage.values()) {
      if (matchesQuery(entity, query)) {
        count++
      }
    }
    return count
  }

  // =============================================================================
  // Bulk Operations
  // =============================================================================

  async bulkCreate(items: Omit<T, 'id'>[]): Promise<T[]> {
    const results: T[] = []
    for (const item of items) {
      const entity = await this.create(item)
      results.push(entity)
    }
    return results
  }

  async bulkUpdate(filter: Query<T>, patch: Partial<T>): Promise<number> {
    let count = 0
    const toUpdate: Array<{ id: string; entity: T }> = []

    // Collect entities to update
    for await (const entity of this.storage.values()) {
      if (matchesQuery(entity, filter)) {
        toUpdate.push({ id: entity.id, entity })
      }
    }

    // Perform updates
    for (const { id, entity } of toUpdate) {
      const previousData = { ...entity }
      const updated = { ...entity, ...patch } as T
      await this.storage.set(id, updated)
      this.emit('update', id, updated, previousData as T)
      count++
    }

    return count
  }

  async bulkDelete(filter: Query<T>): Promise<number> {
    const toDelete: Array<{ id: string; data: T }> = []

    // Collect entities to delete
    for await (const entity of this.storage.values()) {
      if (matchesQuery(entity, filter)) {
        toDelete.push({ id: entity.id, data: entity })
      }
    }

    // Perform deletions
    for (const { id, data } of toDelete) {
      await this.storage.delete(id)
      this.emit('delete', id, undefined, data)
    }

    return toDelete.length
  }

  // =============================================================================
  // Watch (Change Streams)
  // =============================================================================

  async *watch(query?: Query<T>): AsyncIterable<ChangeEvent<T>> {
    // Create an async queue for events
    const eventQueue: ChangeEvent<T>[] = []
    let resolveNext: ((value: ChangeEvent<T>) => void) | null = null

    const listener: EventListener<T> = (event) => {
      // Filter events based on query
      // For create/update, check if the data matches the query
      // For delete, check if the previousData matched the query
      const dataToCheck = event.type === 'delete' ? event.previousData : event.data
      if (dataToCheck && query && !matchesQuery(dataToCheck, query)) {
        return
      }

      if (resolveNext) {
        resolveNext(event)
        resolveNext = null
      } else {
        eventQueue.push(event)
      }
    }

    // Register the listener
    this.listeners.add(listener)

    try {
      while (true) {
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!
        } else {
          // Wait for the next event
          yield new Promise<ChangeEvent<T>>((resolve) => {
            resolveNext = resolve
          })
        }
      }
    } finally {
      // Cleanup when the iterator is closed
      this.listeners.delete(listener)
    }
  }

  // =============================================================================
  // Schema
  // =============================================================================

  schema(): ResourceSchema<T> {
    return this._schema
  }
}
