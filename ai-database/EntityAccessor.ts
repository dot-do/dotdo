/**
 * EntityAccessor - Type-safe entity operations with NL query support
 *
 * Provides CRUD operations and natural language queries for a specific entity type.
 * Accessed via db.EntityName pattern.
 */

import type { ThingEntity, ThingsStore } from '../db/stores'
import type { EntityAccessor as IEntityAccessor, ListOptions, SearchOptions, DBPromise as IDBPromise } from './types'
import { DBPromise, type DBPromiseDataSource } from './DBPromise'

// ============================================================================
// NL QUERY EXECUTOR INTERFACE
// ============================================================================

/**
 * Interface for natural language query execution
 */
export interface NLQueryExecutor {
  /**
   * Execute a natural language query and return SQL or filter operations
   */
  execute(
    entityType: string,
    query: string,
    values: unknown[]
  ): Promise<ThingEntity[]>
}

// ============================================================================
// ENTITY ACCESSOR IMPLEMENTATION
// ============================================================================

/**
 * EntityAccessor provides CRUD operations for a specific entity type.
 * Supports natural language queries via template literal syntax.
 */
export class EntityAccessor<T extends ThingEntity = ThingEntity>
  implements IEntityAccessor<T>
{
  private entityType: string
  private store: ThingsStore
  private nlExecutor?: NLQueryExecutor
  private searchStore?: {
    query(text: string, options?: { type?: string; limit?: number }): Promise<Array<{ $id: string; score: number }>>
    semantic(text: string, options?: { type?: string; limit?: number }): Promise<Array<{ $id: string; score: number }>>
  }

  constructor(
    entityType: string,
    store: ThingsStore,
    options?: {
      nlExecutor?: NLQueryExecutor
      searchStore?: EntityAccessor<T>['searchStore']
    }
  ) {
    this.entityType = entityType
    this.store = store
    this.nlExecutor = options?.nlExecutor
    this.searchStore = options?.searchStore
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async get(id: string): Promise<T | null> {
    const result = await this.store.get(id)
    if (!result) return null
    if (result.$type !== this.entityType) return null
    return result as T
  }

  list(options?: ListOptions): IDBPromise<T> {
    const dataSource = this.createDataSource(options)
    return new DBPromise<T>(dataSource)
  }

  find(query: Record<string, unknown>): IDBPromise<T> {
    const dataSource = this.createDataSource()
    let promise = new DBPromise<T>(dataSource)

    // Apply query filters
    for (const [key, value] of Object.entries(query)) {
      promise = promise.where(key as keyof T, value as T[keyof T])
    }

    return promise
  }

  search(text: string, options?: SearchOptions): IDBPromise<T> {
    const searchType = options?.type ?? 'text'
    const limit = options?.limit ?? 100
    const threshold = options?.threshold ?? 0

    // Create a data source that uses search results
    const dataSource: DBPromiseDataSource = {
      fetchAll: async () => {
        if (!this.searchStore) {
          // Fallback to basic text search on name field
          const all = await this.store.list({ type: this.entityType })
          const searchLower = text.toLowerCase()
          return all.filter((item) => {
            const name = item.name?.toLowerCase() ?? ''
            const data = item.data as Record<string, unknown> | undefined
            const description = (data?.description as string)?.toLowerCase() ?? ''
            return name.includes(searchLower) || description.includes(searchLower)
          })
        }

        // Use search store
        const searchFn = searchType === 'semantic' ? this.searchStore.semantic : this.searchStore.query
        const searchResults = await searchFn(text, { type: this.entityType, limit })

        // Filter by threshold and fetch full entities
        const validResults = searchResults.filter((r) => r.score >= threshold)
        const entities = await Promise.all(
          validResults.map((r) => this.store.get(r.$id))
        )

        return entities.filter((e): e is ThingEntity => e !== null)
      },
      fetchPage: async (opts) => {
        const all = await dataSource.fetchAll()
        const start = opts.offset ?? 0
        return all.slice(start, start + opts.limit)
      },
      count: async () => {
        const all = await dataSource.fetchAll()
        return all.length
      },
      getEntityType: () => this.entityType,
    }

    return new DBPromise<T>(dataSource)
  }

  async create(data: Partial<T>): Promise<T> {
    const result = await this.store.create({
      ...data,
      $type: this.entityType,
    })
    return result as T
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    const result = await this.store.update(id, data)
    return result as T
  }

  async delete(id: string): Promise<T> {
    const result = await this.store.delete(id)
    return result as T
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NATURAL LANGUAGE QUERY (Template Literal)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Template literal handler for natural language queries
   *
   * @example
   * ```typescript
   * const leads = await db.Lead`who closed deals this month?`
   * const top = await db.Lead`top 10 by revenue in ${region}`
   * ```
   */
  templateLiteralQuery(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): IDBPromise<T> {
    // Reconstruct the query string
    let query = ''
    for (let i = 0; i < strings.length; i++) {
      query += strings[i]
      if (i < values.length) {
        // Placeholder for interpolated values
        query += `$${i + 1}`
      }
    }

    // Capture references for closures
    const nlExecutor = this.nlExecutor
    const entityType = this.entityType
    const fallbackSearch = this.fallbackNLSearch.bind(this)

    // Create data source that uses NL executor
    const dataSource: DBPromiseDataSource = {
      fetchAll: async () => {
        if (!nlExecutor) {
          // Fallback: basic keyword search if no NL executor
          return fallbackSearch(query, values)
        }

        return nlExecutor.execute(entityType, query, values)
      },
      fetchPage: async (opts) => {
        const all = await dataSource.fetchAll()
        const start = opts.offset ?? 0
        return all.slice(start, start + opts.limit)
      },
      count: async () => {
        const all = await dataSource.fetchAll()
        return all.length
      },
      getEntityType: () => entityType,
    }

    return new DBPromise<T>(dataSource)
  }

  /**
   * Fallback NL search using basic keyword matching
   */
  private async fallbackNLSearch(
    query: string,
    values: unknown[]
  ): Promise<ThingEntity[]> {
    // Extract keywords from query
    const stopWords = new Set([
      'who', 'what', 'where', 'when', 'how', 'why',
      'is', 'are', 'was', 'were', 'be', 'been',
      'the', 'a', 'an', 'this', 'that', 'these', 'those',
      'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'with', 'by', 'from', 'of', 'as', 'into',
    ])

    // Replace placeholders with actual values
    let processedQuery = query
    values.forEach((value, i) => {
      processedQuery = processedQuery.replace(`$${i + 1}`, String(value))
    })

    const keywords = processedQuery
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word))

    // Fetch all entities and score by keyword matches
    const all = await this.store.list({ type: this.entityType })

    if (keywords.length === 0) {
      return all
    }

    const scored = all.map((item) => {
      const searchText = [
        item.name ?? '',
        JSON.stringify(item.data ?? {}),
      ].join(' ').toLowerCase()

      const score = keywords.reduce((acc, keyword) => {
        return acc + (searchText.includes(keyword) ? 1 : 0)
      }, 0)

      return { item, score }
    })

    // Return items with at least one keyword match, sorted by score
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.item)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASYNC ITERATION
  // ═══════════════════════════════════════════════════════════════════════════

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const batchSize = 100
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const batch = await this.store.list({
        type: this.entityType,
        limit: batchSize,
        offset,
      })

      for (const item of batch) {
        yield item as T
      }

      offset += batch.length
      hasMore = batch.length === batchSize
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private createDataSource(options?: ListOptions): DBPromiseDataSource {
    return {
      fetchAll: async () => {
        const results = await this.store.list({
          type: this.entityType,
          limit: options?.limit,
          offset: options?.offset,
          orderBy: options?.orderBy,
          order: options?.order,
          branch: options?.branch,
          includeDeleted: options?.includeDeleted,
        })
        return results
      },
      fetchPage: async (opts) => {
        const results = await this.store.list({
          type: this.entityType,
          limit: opts.limit,
          offset: opts.offset,
          after: opts.after,
          branch: options?.branch,
          includeDeleted: options?.includeDeleted,
        })
        return results
      },
      count: async () => {
        // In production, would use COUNT query
        const results = await this.store.list({
          type: this.entityType,
          branch: options?.branch,
          includeDeleted: options?.includeDeleted,
        })
        return results.length
      },
      getEntityType: () => this.entityType,
    }
  }
}

// ============================================================================
// CALLABLE ENTITY ACCESSOR (for template literal support)
// ============================================================================

/**
 * Create a callable EntityAccessor that supports template literal syntax
 */
export function createEntityAccessor<T extends ThingEntity = ThingEntity>(
  entityType: string,
  store: ThingsStore,
  options?: {
    nlExecutor?: NLQueryExecutor
    searchStore?: EntityAccessor<T>['searchStore']
  }
): IEntityAccessor<T> {
  const accessor = new EntityAccessor<T>(entityType, store, options)

  // Create a callable function that handles template literals
  const callable = function (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) {
    return accessor.templateLiteralQuery(strings, ...values)
  } as IEntityAccessor<T>

  // Copy all methods from accessor to callable
  Object.setPrototypeOf(callable, accessor)

  // Bind methods to accessor
  callable.get = accessor.get.bind(accessor)
  callable.list = accessor.list.bind(accessor)
  callable.find = accessor.find.bind(accessor)
  callable.search = accessor.search.bind(accessor)
  callable.create = accessor.create.bind(accessor)
  callable.update = accessor.update.bind(accessor)
  callable.delete = accessor.delete.bind(accessor)

  // Add async iterator
  callable[Symbol.asyncIterator] = accessor[Symbol.asyncIterator].bind(accessor)

  return callable
}
