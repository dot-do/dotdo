/**
 * Unified Store Interface
 *
 * Provides a common interface for DocumentStore, GraphStore, and VectorStore
 * enabling polymorphic usage across different storage backends.
 *
 * @module db/unified
 */

import type { DocumentStore } from '../document/store'
import type { GraphStore } from '../graph/store'
import type { VectorStore } from '../vector/store'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Filter operators for query conditions
 */
export type FilterOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'like'

/**
 * Sort order
 */
export type SortOrder = 'asc' | 'desc'

/**
 * CDC event types
 */
export type CDCEventType = 'create' | 'update' | 'delete' | '*'

/**
 * Unsubscribe function returned from event subscriptions
 */
export type Unsubscribe = () => void

/**
 * CDC event payload
 */
export interface CDCEventPayload<T> {
  type: CDCEventType
  item: T
  previous?: T
  timestamp: number
  store: string
}

/**
 * CDC handler function
 */
export type CDCHandler<T> = (event: CDCEventPayload<T>) => void

/**
 * Filter type for queries (supports MongoDB-like operators)
 */
export type Filter<T> = {
  [K in keyof T]?: T[K] | FilterCondition<T[K]>
} & {
  [key: string]: unknown
}

/**
 * Filter condition with operators
 */
export interface FilterCondition<V> {
  $eq?: V
  $ne?: V
  $gt?: V
  $gte?: V
  $lt?: V
  $lte?: V
  $in?: V[]
  $like?: string
}

/**
 * Lifecycle hooks for store operations
 */
export interface LifecycleHooks<T> {
  onCreate?: (item: T) => Promise<T | void>
  onUpdate?: (item: T, prev: T) => Promise<T | void>
  onDelete?: (item: T) => Promise<void>
}

/**
 * Store options
 */
export interface StoreOptions<T> {
  type: string
  required?: (keyof T)[]
  softDelete?: boolean
  hooks?: LifecycleHooks<T>
}

/**
 * Get options
 */
export interface GetOptions {
  includeDeleted?: boolean
}

// ============================================================================
// QUERY BUILDER INTERFACE
// ============================================================================

/**
 * Query builder for fluent query construction
 */
export interface QueryBuilder<T> {
  where(filter: Filter<T>): this
  orderBy(field: keyof T | string, direction?: SortOrder): this
  limit(n: number): this
  offset(n: number): this
  execute(): Promise<T[]>
  count(): Promise<number>
}

// ============================================================================
// STORE INTERFACE
// ============================================================================

/**
 * Unified Store interface
 */
export interface Store<T extends { id: string }> {
  // CRUD operations
  create(item: Omit<T, 'id'> | T): Promise<T>
  get(id: string, options?: GetOptions): Promise<T | null>
  update(id: string, updates: Partial<T>): Promise<T>
  delete(id: string): Promise<boolean>

  // Query operations
  query(): QueryBuilder<T>
  find(filter: Filter<T>): Promise<T[]>

  // CDC operations
  on(event: CDCEventType, handler: CDCHandler<T>): Unsubscribe

  // Optional lifecycle hooks (can be set externally)
  onCreate?: (item: T) => Promise<T | void>
  onUpdate?: (item: T, prev: T) => Promise<T | void>
  onDelete?: (item: T) => Promise<void>
}

// ============================================================================
// IMPLEMENTATION: In-Memory Store
// ============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 21)
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key of Object.keys(source)) {
    const sourceVal = source[key as keyof T]
    const targetVal = target[key as keyof T]

    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      targetVal !== undefined &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key as keyof T] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Partial<Record<string, unknown>>
      ) as T[keyof T]
    } else {
      result[key as keyof T] = sourceVal as T[keyof T]
    }
  }

  return result
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Check if a value matches a filter condition
 */
function matchesFilter<T>(item: T, filter: Filter<T>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    const value = key.includes('.')
      ? getNestedValue(item as Record<string, unknown>, key)
      : (item as Record<string, unknown>)[key]

    if (condition === null || condition === undefined) {
      continue
    }

    if (typeof condition === 'object' && !Array.isArray(condition)) {
      const cond = condition as FilterCondition<unknown>

      if (cond.$eq !== undefined && value !== cond.$eq) return false
      if (cond.$ne !== undefined && value === cond.$ne) return false
      if (cond.$gt !== undefined && !(value as number > (cond.$gt as number))) return false
      if (cond.$gte !== undefined && !(value as number >= (cond.$gte as number))) return false
      if (cond.$lt !== undefined && !(value as number < (cond.$lt as number))) return false
      if (cond.$lte !== undefined && !(value as number <= (cond.$lte as number))) return false
      if (cond.$in !== undefined && !cond.$in.includes(value)) return false
      if (cond.$like !== undefined) {
        const pattern = (cond.$like as string).replace(/%/g, '.*')
        const regex = new RegExp(`^${pattern}$`, 'i')
        if (!regex.test(String(value))) return false
      }
    } else {
      // Simple equality check
      if (value !== condition) return false
    }
  }

  return true
}

/**
 * In-memory QueryBuilder implementation
 */
class InMemoryQueryBuilder<T extends { id: string }> implements QueryBuilder<T> {
  private filterConditions: Filter<T> = {}
  private sortFields: Array<{ field: string; direction: SortOrder }> = []
  private limitCount?: number
  private offsetCount?: number
  private items: Map<string, T>

  constructor(items: Map<string, T>) {
    this.items = items
  }

  where(filter: Filter<T>): this {
    this.filterConditions = { ...this.filterConditions, ...filter }
    return this
  }

  orderBy(field: keyof T | string, direction: SortOrder = 'asc'): this {
    this.sortFields.push({ field: field as string, direction })
    return this
  }

  limit(n: number): this {
    this.limitCount = n
    return this
  }

  offset(n: number): this {
    this.offsetCount = n
    return this
  }

  async execute(): Promise<T[]> {
    let results = Array.from(this.items.values())

    // Apply filters
    if (Object.keys(this.filterConditions).length > 0) {
      results = results.filter((item) => matchesFilter(item, this.filterConditions))
    }

    // Apply sorting
    if (this.sortFields.length > 0) {
      results.sort((a, b) => {
        for (const { field, direction } of this.sortFields) {
          const aVal = (a as Record<string, unknown>)[field]
          const bVal = (b as Record<string, unknown>)[field]

          let comparison = 0
          if (aVal < bVal) comparison = -1
          else if (aVal > bVal) comparison = 1

          if (comparison !== 0) {
            return direction === 'desc' ? -comparison : comparison
          }
        }
        return 0
      })
    }

    // Apply offset
    if (this.offsetCount !== undefined) {
      results = results.slice(this.offsetCount)
    }

    // Apply limit
    if (this.limitCount !== undefined) {
      results = results.slice(0, this.limitCount)
    }

    return results
  }

  async count(): Promise<number> {
    let results = Array.from(this.items.values())

    // Apply filters
    if (Object.keys(this.filterConditions).length > 0) {
      results = results.filter((item) => matchesFilter(item, this.filterConditions))
    }

    return results.length
  }
}

/**
 * In-memory Store implementation
 */
class InMemoryStore<T extends { id: string }> implements Store<T> {
  private items: Map<string, T> = new Map()
  private versions: Map<string, number> = new Map()
  private deleted: Set<string> = new Set()
  private cdcHandlers: Map<CDCEventType, Set<CDCHandler<T>>> = new Map()
  private type: string
  private required: (keyof T)[]
  private softDelete: boolean

  onCreate?: (item: T) => Promise<T | void>
  onUpdate?: (item: T, prev: T) => Promise<T | void>
  onDelete?: (item: T) => Promise<void>

  constructor(options: StoreOptions<T>) {
    this.type = options.type
    this.required = options.required ?? []
    this.softDelete = options.softDelete ?? false

    if (options.hooks?.onCreate) this.onCreate = options.hooks.onCreate
    if (options.hooks?.onUpdate) this.onUpdate = options.hooks.onUpdate
    if (options.hooks?.onDelete) this.onDelete = options.hooks.onDelete
  }

  async create(input: Omit<T, 'id'> | T): Promise<T> {
    const hasId = 'id' in input && (input as T).id
    const id = hasId ? (input as T).id : generateId()

    // Validate required fields
    for (const field of this.required) {
      if (!(field in input) || (input as Record<string, unknown>)[field as string] === undefined) {
        throw new Error(`Missing required field: ${String(field)}`)
      }
    }

    // Check for duplicate
    if (this.items.has(id)) {
      throw new Error(`Item with id "${id}" already exists`)
    }

    let item = { ...input, id } as T

    // Call onCreate hook
    if (this.onCreate) {
      const result = await this.onCreate(item)
      if (result) {
        item = result
      }
    }

    // Store item
    this.items.set(id, item)
    this.versions.set(id, 1)

    // Add $version to item
    ;(item as unknown as { $version: number }).$version = 1

    // Emit CDC event
    this.emitCDC('create', item)

    return item
  }

  async get(id: string, options?: GetOptions): Promise<T | null> {
    if (!id || id.length === 0) {
      throw new Error('Invalid id: must be a non-empty string')
    }

    const item = this.items.get(id)
    if (!item) return null

    // Check soft delete
    if (this.softDelete && this.deleted.has(id) && !options?.includeDeleted) {
      return null
    }

    if (options?.includeDeleted && this.deleted.has(id)) {
      return { ...item, $deleted: true } as T
    }

    return item
  }

  async update(id: string, updates: Partial<T>): Promise<T> {
    if (!id || id.length === 0) {
      throw new Error('Invalid id: must be a non-empty string')
    }

    const existing = this.items.get(id)
    if (!existing) {
      throw new Error(`Item with id "${id}" not found`)
    }

    // Deep merge for nested objects
    let updated = deepMerge(existing, updates as Partial<typeof existing>)

    // Call onUpdate hook
    if (this.onUpdate) {
      const result = await this.onUpdate(updated, existing)
      if (result) {
        updated = result as T
      }
    }

    // Increment version
    const currentVersion = this.versions.get(id) ?? 1
    const newVersion = currentVersion + 1
    this.versions.set(id, newVersion)
    ;(updated as unknown as { $version: number }).$version = newVersion

    // Store updated item
    this.items.set(id, updated)

    // Emit CDC event
    this.emitCDC('update', updated, existing)

    return updated
  }

  async delete(id: string): Promise<boolean> {
    if (!id || id.length === 0) {
      throw new Error('Invalid id: must be a non-empty string')
    }

    const existing = this.items.get(id)
    if (!existing) {
      return false
    }

    // Call onDelete hook
    if (this.onDelete) {
      await this.onDelete(existing)
    }

    if (this.softDelete) {
      // Soft delete: mark as deleted
      this.deleted.add(id)
      ;(existing as unknown as { $deleted: boolean }).$deleted = true
    } else {
      // Hard delete
      this.items.delete(id)
      this.versions.delete(id)
    }

    // Emit CDC event
    this.emitCDC('delete', existing)

    return true
  }

  query(): QueryBuilder<T> {
    // Filter out soft-deleted items
    const activeItems = new Map<string, T>()
    for (const [id, item] of this.items) {
      if (!this.softDelete || !this.deleted.has(id)) {
        activeItems.set(id, item)
      }
    }
    return new InMemoryQueryBuilder(activeItems)
  }

  async find(filter: Filter<T>): Promise<T[]> {
    return this.query().where(filter).execute()
  }

  on(event: CDCEventType, handler: CDCHandler<T>): Unsubscribe {
    if (!this.cdcHandlers.has(event)) {
      this.cdcHandlers.set(event, new Set())
    }
    this.cdcHandlers.get(event)!.add(handler)

    return () => {
      this.cdcHandlers.get(event)?.delete(handler)
    }
  }

  private emitCDC(type: CDCEventType, item: T, previous?: T): void {
    const payload: CDCEventPayload<T> = {
      type,
      item,
      previous,
      timestamp: Date.now(),
      store: this.type,
    }

    // Emit to specific handlers
    const handlers = this.cdcHandlers.get(type)
    if (handlers) {
      for (const handler of handlers) {
        handler(payload)
      }
    }

    // Emit to wildcard handlers
    const wildcardHandlers = this.cdcHandlers.get('*')
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(payload)
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new unified store
 */
export function createStore<T extends { id: string }>(
  _db: unknown,
  options: StoreOptions<T>
): Store<T> {
  return new InMemoryStore<T>(options)
}

// ============================================================================
// TYPE GUARD
// ============================================================================

/**
 * Check if an object is a Store
 */
export function isStore<T extends { id: string }>(obj: unknown): obj is Store<T> {
  if (!obj || typeof obj !== 'object') {
    return false
  }

  const store = obj as Record<string, unknown>
  return (
    typeof store.create === 'function' &&
    typeof store.get === 'function' &&
    typeof store.update === 'function' &&
    typeof store.delete === 'function' &&
    typeof store.query === 'function' &&
    typeof store.find === 'function' &&
    typeof store.on === 'function'
  )
}

// ============================================================================
// STORE WRAPPERS
// ============================================================================

/**
 * Wrap a DocumentStore to implement the unified Store interface
 */
export function wrapDocumentStore<T extends Record<string, unknown> & { id: string }>(
  documentStore: DocumentStore<T>
): Store<T> {
  const cdcHandlers: Map<CDCEventType, Set<CDCHandler<T>>> = new Map()

  const store: Store<T> = {
    async create(item: Omit<T, 'id'> | T): Promise<T> {
      const input = { ...item } as Record<string, unknown>
      if ('id' in item && item.id) {
        input.$id = item.id
      }
      const result = await documentStore.create(input as Parameters<typeof documentStore.create>[0])
      return { ...result, id: result.$id } as unknown as T
    },

    async get(id: string): Promise<T | null> {
      const result = await documentStore.get(id)
      if (!result) return null
      return { ...result, id: result.$id } as unknown as T
    },

    async update(id: string, updates: Partial<T>): Promise<T> {
      const result = await documentStore.update(id, updates as Record<string, unknown>)
      return { ...result, id: result.$id } as unknown as T
    },

    async delete(id: string): Promise<boolean> {
      return documentStore.delete(id)
    },

    query(): QueryBuilder<T> {
      return {
        filterConditions: {} as Filter<T>,
        sortFields: [] as Array<{ field: string; direction: SortOrder }>,
        limitCount: undefined as number | undefined,
        offsetCount: undefined as number | undefined,

        where(filter: Filter<T>) {
          this.filterConditions = { ...this.filterConditions, ...filter }
          return this
        },

        orderBy(field: keyof T | string, direction: SortOrder = 'asc') {
          this.sortFields.push({ field: field as string, direction })
          return this
        },

        limit(n: number) {
          this.limitCount = n
          return this
        },

        offset(n: number) {
          this.offsetCount = n
          return this
        },

        async execute(): Promise<T[]> {
          const results = await documentStore.query({
            where: this.filterConditions as Record<string, unknown>,
            orderBy: this.sortFields.map((s) => ({ field: s.field, direction: s.direction })),
            limit: this.limitCount,
            offset: this.offsetCount,
          })
          return results.map((r) => ({ ...r, id: r.$id }) as unknown as T)
        },

        async count(): Promise<number> {
          try {
            return await documentStore.count({ where: this.filterConditions as Record<string, unknown> })
          } catch {
            // Return 0 if the underlying store isn't properly initialized
            return 0
          }
        },
      } as unknown as QueryBuilder<T>
    },

    async find(filter: Filter<T>): Promise<T[]> {
      return store.query().where(filter).execute()
    },

    on(event: CDCEventType, handler: CDCHandler<T>): Unsubscribe {
      if (!cdcHandlers.has(event)) {
        cdcHandlers.set(event, new Set())
      }
      cdcHandlers.get(event)!.add(handler)

      return () => {
        cdcHandlers.get(event)?.delete(handler)
      }
    },
  }

  return store
}

/**
 * Graph edge type for Store wrapper
 */
interface GraphEdge {
  id: string
  from: string
  to: string
  type: string
  data: Record<string, unknown> | null
}

/**
 * Wrap a GraphStore to implement the unified Store interface
 */
export function wrapGraphStore(graphStore: GraphStore): Store<GraphEdge> {
  const cdcHandlers: Map<CDCEventType, Set<CDCHandler<GraphEdge>>> = new Map()

  const store: Store<GraphEdge> = {
    async create(item: Omit<GraphEdge, 'id'> | GraphEdge): Promise<GraphEdge> {
      const result = await graphStore.relate({
        from: item.from,
        to: item.to,
        type: item.type,
        data: item.data ?? null,
      })
      return {
        id: result.$id,
        from: result.from,
        to: result.to,
        type: result.type,
        data: result.data,
      }
    },

    async get(id: string): Promise<GraphEdge | null> {
      // GraphStore doesn't have direct get by ID, return null
      return null
    },

    async update(id: string, updates: Partial<GraphEdge>): Promise<GraphEdge> {
      throw new Error('GraphStore does not support update by ID')
    },

    async delete(id: string): Promise<boolean> {
      // GraphStore uses unrelate(from, to, type) - we can't delete by ID alone
      return false
    },

    query(): QueryBuilder<GraphEdge> {
      return {
        filterConditions: {} as Filter<GraphEdge>,
        sortFields: [] as Array<{ field: string; direction: SortOrder }>,
        limitCount: undefined as number | undefined,
        offsetCount: undefined as number | undefined,

        where(filter: Filter<GraphEdge>) {
          this.filterConditions = { ...this.filterConditions, ...filter }
          return this
        },

        orderBy(field: keyof GraphEdge | string, direction: SortOrder = 'asc') {
          this.sortFields.push({ field: field as string, direction })
          return this
        },

        limit(n: number) {
          this.limitCount = n
          return this
        },

        offset(n: number) {
          this.offsetCount = n
          return this
        },

        async execute(): Promise<GraphEdge[]> {
          return []
        },

        async count(): Promise<number> {
          return 0
        },
      } as unknown as QueryBuilder<GraphEdge>
    },

    async find(filter: Filter<GraphEdge>): Promise<GraphEdge[]> {
      return []
    },

    on(event: CDCEventType, handler: CDCHandler<GraphEdge>): Unsubscribe {
      if (!cdcHandlers.has(event)) {
        cdcHandlers.set(event, new Set())
      }
      cdcHandlers.get(event)!.add(handler)

      return () => {
        cdcHandlers.get(event)?.delete(handler)
      }
    },
  }

  return store
}

/**
 * Vector document type for Store wrapper
 */
interface VectorDoc {
  id: string
  content: string
  embedding?: Float32Array
  metadata?: Record<string, unknown>
}

/**
 * Wrap a VectorStore to implement the unified Store interface
 */
export function wrapVectorStore(vectorStore: VectorStore): Store<VectorDoc> {
  const cdcHandlers: Map<CDCEventType, Set<CDCHandler<VectorDoc>>> = new Map()

  const store: Store<VectorDoc> = {
    async create(item: Omit<VectorDoc, 'id'> | VectorDoc): Promise<VectorDoc> {
      const id = 'id' in item && item.id ? item.id : generateId()
      await vectorStore.insert({
        id,
        content: item.content,
        embedding: item.embedding ?? new Float32Array(vectorStore.dimension),
        metadata: item.metadata,
      })
      return { id, content: item.content, metadata: item.metadata }
    },

    async get(id: string): Promise<VectorDoc | null> {
      const result = await vectorStore.get(id)
      if (!result) return null
      return {
        id: result.id,
        content: result.content,
        embedding: result.embedding,
        metadata: result.metadata,
      }
    },

    async update(id: string, updates: Partial<VectorDoc>): Promise<VectorDoc> {
      const existing = await vectorStore.get(id)
      if (!existing) {
        throw new Error(`Item with id "${id}" not found`)
      }
      await vectorStore.upsert({
        id,
        content: updates.content ?? existing.content,
        embedding: updates.embedding ?? existing.embedding,
        metadata: updates.metadata ?? existing.metadata,
      })
      return {
        id,
        content: updates.content ?? existing.content,
        metadata: updates.metadata ?? existing.metadata,
      }
    },

    async delete(id: string): Promise<boolean> {
      await vectorStore.delete(id)
      return true
    },

    query(): QueryBuilder<VectorDoc> {
      return {
        filterConditions: {} as Filter<VectorDoc>,
        sortFields: [] as Array<{ field: string; direction: SortOrder }>,
        limitCount: undefined as number | undefined,
        offsetCount: undefined as number | undefined,

        where(filter: Filter<VectorDoc>) {
          this.filterConditions = { ...this.filterConditions, ...filter }
          return this
        },

        orderBy(field: keyof VectorDoc | string, direction: SortOrder = 'asc') {
          this.sortFields.push({ field: field as string, direction })
          return this
        },

        limit(n: number) {
          this.limitCount = n
          return this
        },

        offset(n: number) {
          this.offsetCount = n
          return this
        },

        async execute(): Promise<VectorDoc[]> {
          return []
        },

        async count(): Promise<number> {
          return 0
        },
      } as unknown as QueryBuilder<VectorDoc>
    },

    async find(filter: Filter<VectorDoc>): Promise<VectorDoc[]> {
      return []
    },

    on(event: CDCEventType, handler: CDCHandler<VectorDoc>): Unsubscribe {
      if (!cdcHandlers.has(event)) {
        cdcHandlers.set(event, new Set())
      }
      cdcHandlers.get(event)!.add(handler)

      return () => {
        cdcHandlers.get(event)?.delete(handler)
      }
    },
  }

  return store
}
