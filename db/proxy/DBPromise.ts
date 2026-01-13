/**
 * DBPromise - Fluent Query Builder with Promise Interface
 *
 * Provides chainable query methods that resolve to results.
 * Supports filtering, mapping, sorting, pagination, and batch processing.
 */

import type { ThingEntity } from '../stores'
import type {
  DBPromise as IDBPromise,
  ForEachOptions,
  ForEachResult,
  ForEachProgress,
} from './types'
import { getProperty, isRecord } from '../../lib/type-guards'

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Error thrown when a DBPromise method is not yet implemented.
 * Provides actionable guidance for workarounds.
 */
export class NotImplementedError extends Error {
  readonly method: string

  constructor(method: string, message?: string) {
    super(message ?? `DBPromise.${method}() is not yet implemented`)
    this.name = 'NotImplementedError'
    this.method = method
  }
}

// ============================================================================
// QUERY OPERATION TYPES
// ============================================================================

type FilterOp = { type: 'filter'; predicate: (item: ThingEntity) => boolean }
type WhereOp = { type: 'where'; field: string; value: unknown }
type WhereOpOp = { type: 'whereOp'; field: string; op: string; value: unknown }
type MapOp = { type: 'map'; mapper: (item: ThingEntity) => ThingEntity }
type SelectOp = { type: 'select'; fields: string[] }
type SortOp = { type: 'sort'; compareFn: (a: ThingEntity, b: ThingEntity) => number }
type OrderByOp = { type: 'orderBy'; field: string; direction: 'asc' | 'desc' }
type LimitOp = { type: 'limit'; n: number }
type OffsetOp = { type: 'offset'; n: number }
type AfterOp = { type: 'after'; cursor: string }
type ExpandOp = { type: 'expand'; relations: string[] }

type QueryOp = FilterOp | WhereOp | WhereOpOp | MapOp | SelectOp | SortOp | OrderByOp | LimitOp | OffsetOp | AfterOp | ExpandOp

// ============================================================================
// DATA SOURCE INTERFACE
// ============================================================================

/**
 * Relationship definition for expand operations
 */
export interface RelationshipDefinition {
  /**
   * The relationship name (e.g., 'company', 'contacts', 'author')
   */
  name: string

  /**
   * The target entity type (e.g., 'Company', 'Contact', 'User')
   */
  targetType: string

  /**
   * The relationship cardinality: 'one' for single entity, 'many' for array
   */
  cardinality: 'one' | 'many'

  /**
   * The field on the source entity that contains the reference.
   * Can be a direct ID field (e.g., 'companyId') or a path for nested lookup.
   */
  foreignKey?: string

  /**
   * The verb used in the relationships table (e.g., 'belongs_to', 'has_many')
   */
  verb?: string
}

/**
 * Options for relationship expansion
 */
export interface ExpandOptions {
  /**
   * Maximum depth for nested expansions (default: 3)
   */
  maxDepth?: number

  /**
   * Whether to include circular references (default: false, returns null for cycles)
   */
  allowCircular?: boolean
}

/**
 * Interface for the data source that DBPromise queries
 */
export interface DBPromiseDataSource {
  /**
   * Fetch all items of the entity type
   */
  fetchAll(): Promise<ThingEntity[]>

  /**
   * Fetch items with pagination
   */
  fetchPage(options: { limit: number; offset?: number; after?: string }): Promise<ThingEntity[]>

  /**
   * Count total items
   */
  count(): Promise<number>

  /**
   * Get entity type name
   */
  getEntityType(): string

  /**
   * Persist forEach progress (for crash recovery)
   */
  persistProgress?(tracker: ForEachProgress & { runId: string; completedIds: string[] }): Promise<void>

  /**
   * Load forEach progress (for resume)
   */
  loadProgress?(runId: string): Promise<{ completedIds: string[]; cursor?: string } | null>

  /**
   * Get relationship definitions for the entity type.
   * Returns a map of relationship name to definition.
   */
  getRelationships?(): Map<string, RelationshipDefinition>

  /**
   * Resolve a relationship for a single item.
   * Returns the related entity or entities.
   *
   * @param item - The source entity
   * @param relationName - The relationship name to expand
   * @param visited - Set of already-visited entity IDs (for cycle detection)
   */
  resolveRelationship?(
    item: ThingEntity,
    relationName: string,
    visited?: Set<string>
  ): Promise<ThingEntity | ThingEntity[] | null>
}

// ============================================================================
// DBPROMISE IMPLEMENTATION
// ============================================================================

/**
 * DBPromise implementation that wraps query operations
 */
export class DBPromise<T extends ThingEntity = ThingEntity> implements IDBPromise<T> {
  private operations: QueryOp[] = []
  private dataSource: DBPromiseDataSource
  private resolved: Promise<T[]> | null = null

  constructor(dataSource: DBPromiseDataSource, operations: QueryOp[] = []) {
    this.dataSource = dataSource
    this.operations = [...operations]
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMISE INTERFACE
  // ═══════════════════════════════════════════════════════════════════════════

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<T[] | TResult> {
    return this.execute().catch(onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<T[]> {
    return this.execute().finally(onfinally)
  }

  [Symbol.toStringTag] = 'DBPromise'

  // ═══════════════════════════════════════════════════════════════════════════
  // FILTERING
  // ═══════════════════════════════════════════════════════════════════════════

  filter(predicate: (item: T) => boolean): DBPromise<T> {
    return new DBPromise<T>(this.dataSource, [
      ...this.operations,
      { type: 'filter', predicate: predicate as (item: ThingEntity) => boolean },
    ])
  }

  where<K extends keyof T>(field: K, value: T[K]): DBPromise<T> {
    return new DBPromise<T>(this.dataSource, [
      ...this.operations,
      { type: 'where', field: field as string, value },
    ])
  }

  whereOp<K extends keyof T>(
    field: K,
    op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'startsWith' | 'endsWith',
    value: unknown
  ): DBPromise<T> {
    return new DBPromise<T>(this.dataSource, [
      ...this.operations,
      { type: 'whereOp', field: field as string, op, value },
    ])
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFORMATION
  // ═══════════════════════════════════════════════════════════════════════════

  map<U extends ThingEntity>(mapper: (item: T) => U): DBPromise<U> {
    // The mapper signature is compatible at runtime since T extends ThingEntity
    // We use a wrapper function to maintain proper typing through the operation pipeline
    const wrappedMapper = (item: ThingEntity): ThingEntity => mapper(item as T)
    return new DBPromise<U>(this.dataSource, [
      ...this.operations,
      { type: 'map', mapper: wrappedMapper },
    ])
  }

  select<K extends keyof T>(...fields: K[]): DBPromise<T> {
    return new DBPromise<T>(this.dataSource, [
      ...this.operations,
      { type: 'select', fields: fields as string[] },
    ])
  }

  expand(...relations: string[]): DBPromise<T> {
    // Validate that relations are provided
    if (relations.length === 0) {
      return this as DBPromise<T>
    }

    // Support nested expansions via dot notation (e.g., 'company.employees')
    // Each relation in the array will be expanded
    return new DBPromise<T>(this.dataSource, [
      ...this.operations,
      { type: 'expand', relations },
    ])
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORDERING
  // ═══════════════════════════════════════════════════════════════════════════

  sort(compareFn: (a: T, b: T) => number): DBPromise<T> {
    return new DBPromise<T>(this.dataSource, [
      ...this.operations,
      { type: 'sort', compareFn: compareFn as (a: ThingEntity, b: ThingEntity) => number },
    ])
  }

  orderBy<K extends keyof T>(field: K, direction: 'asc' | 'desc' = 'asc'): DBPromise<T> {
    return new DBPromise<T>(this.dataSource, [
      ...this.operations,
      { type: 'orderBy', field: field as string, direction },
    ])
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGINATION
  // ═══════════════════════════════════════════════════════════════════════════

  limit(n: number): DBPromise<T> {
    return new DBPromise<T>(this.dataSource, [
      ...this.operations,
      { type: 'limit', n },
    ])
  }

  offset(n: number): DBPromise<T> {
    return new DBPromise<T>(this.dataSource, [
      ...this.operations,
      { type: 'offset', n },
    ])
  }

  after(cursor: string): DBPromise<T> {
    return new DBPromise<T>(this.dataSource, [
      ...this.operations,
      { type: 'after', cursor },
    ])
  }

  paginate(options: { limit: number; cursor?: string }): DBPromise<T> & { nextCursor: Promise<string | null> } {
    const promise = options.cursor
      ? this.after(options.cursor).limit(options.limit + 1)
      : this.limit(options.limit + 1)

    // Wrap to provide nextCursor
    const wrapped = promise as DBPromise<T> & { nextCursor: Promise<string | null> }
    wrapped.nextCursor = promise.then((results) => {
      if (results.length > options.limit) {
        return results[options.limit]!.$id
      }
      return null
    })

    return wrapped
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGGREGATION
  // ═══════════════════════════════════════════════════════════════════════════

  async count(): Promise<number> {
    const results = await this.execute()
    return results.length
  }

  async first(): Promise<T | null> {
    const results = await this.limit(1).execute()
    return results[0] ?? null
  }

  async exists(): Promise<boolean> {
    const results = await this.limit(1).execute()
    return results.length > 0
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════

  async forEach(
    fn: (item: T, index: number) => Promise<void>,
    options: ForEachOptions = {}
  ): Promise<ForEachResult> {
    const {
      concurrency = 1,
      maxRetries = 3,
      retryDelay = 1000,
      persist = false,
      resume,
      onProgress,
      onError,
      batchSize = 100,
    } = options

    const startTime = Date.now()
    const runId = resume ?? crypto.randomUUID()
    const errors: Array<{ item: string; error: string; attempts: number }> = []

    // Load previous progress if resuming
    let completedIds = new Set<string>()
    if (resume && this.dataSource.loadProgress) {
      const progress = await this.dataSource.loadProgress(resume)
      if (progress) {
        completedIds = new Set(progress.completedIds)
      }
    }

    // Fetch all items
    const allItems = await this.execute()
    const items = allItems.filter((item) => !completedIds.has(item.$id))

    let completed = completedIds.size
    let failed = 0
    let skipped = 0
    let inProgress = 0
    let processedSinceStart = 0

    const total = allItems.length

    const reportProgress = () => {
      if (onProgress) {
        const elapsed = (Date.now() - startTime) / 1000
        const rate = elapsed > 0 ? processedSinceStart / elapsed : 0
        const remaining = total - completed - failed - skipped
        const eta = rate > 0 ? (remaining / rate) * 1000 : 0

        onProgress({
          total,
          completed,
          failed,
          skipped,
          inProgress,
          rate,
          eta,
          runId,
        })
      }
    }

    // Process items with concurrency control
    const processItem = async (item: T, index: number): Promise<void> => {
      let attempts = 0
      let lastError: Error | null = null

      while (attempts < maxRetries) {
        attempts++
        try {
          inProgress++
          reportProgress()

          await fn(item, index)

          inProgress--
          completed++
          processedSinceStart++
          completedIds.add(item.$id)

          // Persist progress if enabled
          if (persist && this.dataSource.persistProgress && completed % batchSize === 0) {
            await this.dataSource.persistProgress({
              total,
              completed,
              failed,
              skipped,
              inProgress,
              rate: 0,
              eta: 0,
              runId,
              completedIds: Array.from(completedIds),
            })
          }

          reportProgress()
          return
        } catch (error) {
          inProgress--
          lastError = error instanceof Error ? error : new Error(String(error))

          if (onError) {
            const action = onError(lastError, item, attempts)
            if (action === 'skip') {
              skipped++
              processedSinceStart++
              reportProgress()
              return
            } else if (action === 'abort') {
              throw lastError
            }
            // 'retry' continues the loop
          }

          if (attempts < maxRetries) {
            // Exponential backoff
            await new Promise((resolve) => setTimeout(resolve, retryDelay * Math.pow(2, attempts - 1)))
          }
        }
      }

      // Max retries exceeded
      failed++
      processedSinceStart++
      if (errors.length < 100) {
        errors.push({
          item: item.$id,
          error: lastError?.message ?? 'Unknown error',
          attempts,
        })
      }
      reportProgress()
    }

    // Process with concurrency
    const chunks: T[][] = []
    for (let i = 0; i < items.length; i += concurrency) {
      chunks.push(items.slice(i, i + concurrency))
    }

    let globalIndex = completedIds.size
    for (const chunk of chunks) {
      await Promise.all(
        chunk.map((item, i) => processItem(item, globalIndex + i))
      )
      globalIndex += chunk.length
    }

    // Final persist
    if (persist && this.dataSource.persistProgress) {
      await this.dataSource.persistProgress({
        total,
        completed,
        failed,
        skipped,
        inProgress: 0,
        rate: 0,
        eta: 0,
        runId,
        completedIds: Array.from(completedIds),
      })
    }

    return {
      completed,
      failed,
      skipped,
      duration: Date.now() - startTime,
      runId,
      errors,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  private async execute(): Promise<T[]> {
    if (this.resolved) {
      return this.resolved as Promise<T[]>
    }

    this.resolved = this.executeOperations()
    return this.resolved as Promise<T[]>
  }

  private async executeOperations(): Promise<T[]> {
    // Fetch base data
    let results: ThingEntity[] = await this.dataSource.fetchAll()

    // Apply operations in order
    for (const op of this.operations) {
      switch (op.type) {
        case 'filter':
          results = results.filter(op.predicate)
          break

        case 'where':
          results = results.filter((item) => {
            const data = item.data as Record<string, unknown> | undefined
            // Check data first, then fall back to item properties using type-safe accessor
            return data?.[op.field] === op.value || getProperty(item, op.field) === op.value
          })
          break

        case 'whereOp':
          results = results.filter((item) => {
            const data = item.data as Record<string, unknown> | undefined
            // Check data first, then fall back to item properties using type-safe accessor
            const fieldValue = data?.[op.field] ?? getProperty(item, op.field)
            return this.evaluateOp(fieldValue, op.op, op.value)
          })
          break

        case 'map':
          results = results.map(op.mapper)
          break

        case 'select':
          results = results.map((item) => {
            const selected: Record<string, unknown> = {}
            for (const field of op.fields) {
              // Use type-safe property accessor
              selected[field] = getProperty(item, field)
            }
            // Create minimal ThingEntity with selected fields
            // $id is required, so ensure it's preserved
            if (!('$id' in selected) && '$id' in item) {
              selected['$id'] = item.$id
            }
            return selected as ThingEntity
          })
          break

        case 'sort':
          results = [...results].sort(op.compareFn)
          break

        case 'orderBy':
          results = [...results].sort((a, b) => {
            const aData = a.data as Record<string, unknown> | undefined
            const bData = b.data as Record<string, unknown> | undefined
            // Check data first, then fall back to item properties using type-safe accessor
            const aVal = aData?.[op.field] ?? getProperty(a, op.field)
            const bVal = bData?.[op.field] ?? getProperty(b, op.field)

            if (aVal === bVal) return 0
            if (aVal === undefined || aVal === null) return op.direction === 'asc' ? 1 : -1
            if (bVal === undefined || bVal === null) return op.direction === 'asc' ? -1 : 1
            if (aVal < bVal) return op.direction === 'asc' ? -1 : 1
            return op.direction === 'asc' ? 1 : -1
          })
          break

        case 'limit':
          results = results.slice(0, op.n)
          break

        case 'offset':
          results = results.slice(op.n)
          break

        case 'after':
          const afterIndex = results.findIndex((r) => r.$id === op.cursor)
          if (afterIndex >= 0) {
            results = results.slice(afterIndex + 1)
          }
          break

        case 'expand':
          // Expand relationships for each result
          results = await this.expandRelationships(results, op.relations)
          break
      }
    }

    return results as T[]
  }

  /**
   * Expand relationships on query results.
   *
   * Supports:
   * - Single relations: expand('company')
   * - Multiple relations: expand('company', 'contacts')
   * - Nested relations via dot notation: expand('company.employees')
   * - Circular reference detection to prevent infinite loops
   *
   * @param items - The items to expand relationships on
   * @param relations - The relation names to expand
   * @returns Items with expanded relationships attached
   */
  private async expandRelationships(
    items: ThingEntity[],
    relations: string[]
  ): Promise<ThingEntity[]> {
    // Check if data source supports relationship resolution
    if (!this.dataSource.resolveRelationship) {
      throw new NotImplementedError(
        'expand',
        `DBPromise.expand() requires a data source with resolveRelationship() implemented. ` +
        'The current data source does not support relationship expansion.'
      )
    }

    const expandedItems: ThingEntity[] = []

    for (const item of items) {
      const expandedItem = await this.expandItemRelationships(
        item,
        relations,
        new Set([item.$id]) // Start visited set with current item to detect self-reference
      )
      expandedItems.push(expandedItem)
    }

    return expandedItems
  }

  /**
   * Expand relationships for a single item.
   *
   * @param item - The item to expand
   * @param relations - Relations to expand
   * @param visited - Set of visited entity IDs for cycle detection
   * @param depth - Current recursion depth
   * @returns Item with expanded relations
   */
  private async expandItemRelationships(
    item: ThingEntity,
    relations: string[],
    visited: Set<string>,
    depth: number = 0
  ): Promise<ThingEntity> {
    const MAX_DEPTH = 10 // Prevent runaway recursion

    if (depth >= MAX_DEPTH) {
      return item
    }

    // Create a shallow copy to avoid mutating the original
    const expanded: ThingEntity = { ...item }
    const expandedData: Record<string, unknown> = { ...(item.data ?? {}) }

    for (const relation of relations) {
      // Handle nested relations (e.g., 'company.employees')
      const [firstRelation, ...nestedRelations] = relation.split('.')

      if (!firstRelation) continue

      try {
        // Resolve the first-level relationship
        const resolved = await this.dataSource.resolveRelationship!(
          item,
          firstRelation,
          visited
        )

        if (resolved === null) {
          // Relation not found or circular reference detected
          expandedData[firstRelation] = null
          continue
        }

        // Handle nested expansions
        if (nestedRelations.length > 0) {
          const nestedRelationPath = nestedRelations.join('.')

          if (Array.isArray(resolved)) {
            // For 'many' relationships, expand nested relations on each item
            const nestedExpanded: ThingEntity[] = []
            for (const relatedItem of resolved) {
              // Add to visited set to detect cycles
              const newVisited = new Set(visited)
              newVisited.add(relatedItem.$id)

              const nestedItem = await this.expandItemRelationships(
                relatedItem,
                [nestedRelationPath],
                newVisited,
                depth + 1
              )
              nestedExpanded.push(nestedItem)
            }
            expandedData[firstRelation] = nestedExpanded
          } else {
            // For 'one' relationships, expand nested relations on the single item
            const newVisited = new Set(visited)
            newVisited.add(resolved.$id)

            const nestedItem = await this.expandItemRelationships(
              resolved,
              [nestedRelationPath],
              newVisited,
              depth + 1
            )
            expandedData[firstRelation] = nestedItem
          }
        } else {
          // No nested expansion needed, just attach the resolved relation
          expandedData[firstRelation] = resolved
        }
      } catch (error) {
        // If expansion fails, set to null and continue
        expandedData[firstRelation] = null
        console.warn(`Failed to expand relation '${relation}' on item '${item.$id}':`, error)
      }
    }

    expanded.data = expandedData
    return expanded
  }

  private evaluateOp(fieldValue: unknown, op: string, value: unknown): boolean {
    switch (op) {
      case 'eq':
        return fieldValue === value
      case 'neq':
        return fieldValue !== value
      case 'gt':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value
      case 'gte':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue >= value
      case 'lt':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value
      case 'lte':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue <= value
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue)
      case 'nin':
        return Array.isArray(value) && !value.includes(fieldValue)
      case 'contains':
        return typeof fieldValue === 'string' && typeof value === 'string' && fieldValue.includes(value)
      case 'startsWith':
        return typeof fieldValue === 'string' && typeof value === 'string' && fieldValue.startsWith(value)
      case 'endsWith':
        return typeof fieldValue === 'string' && typeof value === 'string' && fieldValue.endsWith(value)
      default:
        return false
    }
  }
}
