/**
 * $ Data API - Founder-native data primitives
 *
 * Unified data namespace that integrates all data APIs:
 * - $.data.get/set/delete - Basic CRUD operations
 * - $.data.list - Query collections with filtering
 * - $.data.query - Fluent query builder API
 * - $.data.watch - Real-time subscriptions
 *
 * Plus 7 specialized namespaces:
 * - $.track - Event tracking and analytics
 * - $.measure - Time-series metrics and KPIs
 * - $.experiment - A/B testing
 * - $.goal - OKR and target tracking
 * - $.stream - Real-time data streams
 * - $.view - Materialized views
 * - $.Entity(id).append() - Event sourcing
 *
 * @module workflows/data
 */

// Re-export all namespace implementations
export {
  createTrackContext,
  $step,
  type TrackContext,
  type TrackedEvent,
  type EventSubscription,
  type FunnelStepResult,
  type FunnelResult,
  type CohortResult,
  type TimeSeriesPoint,
  type FilterOperators,
  type TrackOptions,
  type FunnelStep,
  type CohortConfig,
} from './track'

export { createMeasureNamespace } from './measure'

export {
  createExperimentDataContext,
  type ExperimentDataContext,
  type ExperimentNamespace,
  type ExperimentDefinition,
  type ExperimentStatus,
  type ExperimentResults,
  type VariantResults,
  type VariantAssignment,
  type Goal,
} from './experiment'

export {
  createGoalContext,
  type GoalContext,
  type GoalNamespace,
  type GoalInstance,
  type GoalProgress,
  type GoalAlert,
  type GoalHistory,
  type Goal as GoalDefinition,
  type TargetExpression,
} from './goal'

export {
  createStreamContext,
  type StreamContext,
  type Stream,
  type StreamItem,
  type StreamSink,
  type StreamSource,
} from './stream'

export {
  createViewContext,
  type ViewContext,
  type ViewNamespace,
  type ViewInstance,
  type ViewDefinition,
  type ViewQuery,
  type ViewSubscription,
  type AggregateDescriptor,
} from './view/context'

export {
  createEntityEventContext,
  type EntityEventContext,
  type EntityEventProxy,
  type EntityOperations,
  type EntityEvent,
  type EntityState,
  type AggregateDefinition,
  type ProjectionDefinition,
  type SnapshotConfig,
} from './entity-events/entity-events'

// ============================================================================
// UNIFIED DATA CONTEXT TYPES
// ============================================================================

/**
 * Filter operators for query conditions
 */
export interface QueryFilterOperators<T = unknown> {
  eq?: T
  ne?: T
  gt?: T
  gte?: T
  lt?: T
  lte?: T
  in?: T[]
  nin?: T[]
  contains?: string
  startsWith?: string
  endsWith?: string
}

/**
 * Query filter - can be exact match or operator object
 */
export type QueryFilter<T extends Record<string, unknown> = Record<string, unknown>> = {
  [K in keyof T]?: T[K] | QueryFilterOperators<T[K]>
}

/**
 * Sort options for queries
 */
export interface SortOption {
  field: string
  direction: 'asc' | 'desc'
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  limit?: number
  offset?: number
  cursor?: string
}

/**
 * Query options combining filter, sort, and pagination
 */
export interface QueryOptions<T extends Record<string, unknown> = Record<string, unknown>> {
  where?: QueryFilter<T>
  sort?: SortOption | SortOption[]
  limit?: number
  offset?: number
  cursor?: string
}

/**
 * Paginated result with cursor for next page
 */
export interface PaginatedResult<T> {
  items: T[]
  total: number
  hasMore: boolean
  cursor?: string
}

/**
 * Watch callback for real-time updates
 */
export type WatchCallback<T> = (event: WatchEvent<T>) => void | Promise<void>

/**
 * Watch event types
 */
export interface WatchEvent<T> {
  type: 'created' | 'updated' | 'deleted'
  key: string
  value?: T
  previousValue?: T
  timestamp: number
}

/**
 * Watch subscription handle
 */
export interface WatchSubscription {
  unsubscribe: () => void
}

/**
 * Fluent query builder interface
 */
export interface DataQueryBuilder<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Add a where clause */
  where(filter: QueryFilter<T>): DataQueryBuilder<T>
  /** Add equality condition */
  eq(field: keyof T, value: T[keyof T]): DataQueryBuilder<T>
  /** Add greater than condition */
  gt(field: keyof T, value: T[keyof T]): DataQueryBuilder<T>
  /** Add greater than or equal condition */
  gte(field: keyof T, value: T[keyof T]): DataQueryBuilder<T>
  /** Add less than condition */
  lt(field: keyof T, value: T[keyof T]): DataQueryBuilder<T>
  /** Add less than or equal condition */
  lte(field: keyof T, value: T[keyof T]): DataQueryBuilder<T>
  /** Add in array condition */
  in(field: keyof T, values: T[keyof T][]): DataQueryBuilder<T>
  /** Add sort clause */
  orderBy(field: keyof T, direction?: 'asc' | 'desc'): DataQueryBuilder<T>
  /** Set limit */
  limit(n: number): DataQueryBuilder<T>
  /** Set offset */
  offset(n: number): DataQueryBuilder<T>
  /** Execute query and return results */
  get(): Promise<T[]>
  /** Execute query and return first result */
  first(): Promise<T | null>
  /** Execute query and return count */
  count(): Promise<number>
  /** Execute query with pagination */
  paginate(options?: PaginationOptions): Promise<PaginatedResult<T>>
}

/**
 * Collection namespace for typed operations
 */
export interface DataCollection<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Get item by key */
  get(key: string): Promise<T | null>
  /** Set item by key */
  set(key: string, value: T): Promise<void>
  /** Delete item by key */
  delete(key: string): Promise<boolean>
  /** Check if key exists */
  has(key: string): Promise<boolean>
  /** List items with optional filtering */
  list(options?: QueryOptions<T>): Promise<T[]>
  /** Create a query builder */
  query(): DataQueryBuilder<T>
  /** Watch for changes */
  watch(callback: WatchCallback<T>, options?: { where?: QueryFilter<T> }): WatchSubscription
  /** Count items matching filter */
  count(where?: QueryFilter<T>): Promise<number>
}

/**
 * Data namespace - the unified $.data API
 */
export interface DataNamespace {
  /** Get a value by key */
  get<T = unknown>(key: string): Promise<T | null>
  /** Set a value by key */
  set<T = unknown>(key: string, value: T, options?: { ttl?: number }): Promise<void>
  /** Delete a value by key */
  delete(key: string): Promise<boolean>
  /** Check if key exists */
  has(key: string): Promise<boolean>
  /** List keys matching pattern */
  keys(pattern?: string): Promise<string[]>
  /** List values with optional filtering */
  list<T extends Record<string, unknown> = Record<string, unknown>>(options?: QueryOptions<T>): Promise<T[]>
  /** Create a fluent query builder */
  query<T extends Record<string, unknown> = Record<string, unknown>>(collection?: string): DataQueryBuilder<T>
  /** Watch for changes on a key or pattern */
  watch<T = unknown>(keyOrPattern: string, callback: WatchCallback<T>): WatchSubscription
  /** Access a typed collection */
  collection<T extends Record<string, unknown> = Record<string, unknown>>(name: string): DataCollection<T>
}

/**
 * Full data context with all namespaces
 */
export interface FullDataContext {
  /** Unified data primitives */
  data: DataNamespace
  /** Event tracking */
  track: ReturnType<typeof import('./track').createTrackContext>['track']
  /** Business metrics */
  measure: ReturnType<typeof import('./measure').createMeasureNamespace>
  /** A/B testing */
  experiment: import('./experiment').ExperimentNamespace
  /** Goal/OKR tracking */
  goal: import('./goal').GoalNamespace
  /** Real-time streams */
  stream: ReturnType<typeof import('./stream').createStreamContext>['stream']
  /** Materialized views */
  view: import('./view/context').ViewNamespace
  /** Entity event sourcing - dynamic entity proxy */
  [entityName: string]: unknown
  /** Internal storage for testing */
  _storage: DataStorage
}

/**
 * Internal storage interface
 */
export interface DataStorage {
  /** Key-value store */
  kv: Map<string, { value: unknown; expiresAt?: number }>
  /** Collection stores */
  collections: Map<string, Map<string, Record<string, unknown>>>
  /** Watch subscriptions */
  watchers: Map<string, Set<{ callback: WatchCallback<unknown>; filter?: QueryFilter }>>
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Match a value against filter operators
 */
function matchOperator<T>(value: T, ops: QueryFilterOperators<T>): boolean {
  if (ops.eq !== undefined && value !== ops.eq) return false
  if (ops.ne !== undefined && value === ops.ne) return false
  if (ops.gt !== undefined && !((value as number) > (ops.gt as number))) return false
  if (ops.gte !== undefined && !((value as number) >= (ops.gte as number))) return false
  if (ops.lt !== undefined && !((value as number) < (ops.lt as number))) return false
  if (ops.lte !== undefined && !((value as number) <= (ops.lte as number))) return false
  if (ops.in !== undefined && !ops.in.includes(value)) return false
  if (ops.nin !== undefined && ops.nin.includes(value)) return false
  if (ops.contains !== undefined && typeof value === 'string' && !value.includes(ops.contains)) return false
  if (ops.startsWith !== undefined && typeof value === 'string' && !value.startsWith(ops.startsWith)) return false
  if (ops.endsWith !== undefined && typeof value === 'string' && !value.endsWith(ops.endsWith)) return false
  return true
}

/**
 * Check if a record matches a filter
 */
function matchesFilter<T extends Record<string, unknown>>(record: T, filter: QueryFilter<T>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    const value = record[key]

    if (condition === null || condition === undefined) {
      if (value !== condition) return false
      continue
    }

    if (typeof condition === 'object' && !Array.isArray(condition)) {
      // Check if it's an operator object
      const ops = condition as QueryFilterOperators
      if (Object.keys(ops).some((k) => ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'startsWith', 'endsWith'].includes(k))) {
        if (!matchOperator(value, ops)) return false
        continue
      }
    }

    // Direct equality
    if (value !== condition) return false
  }
  return true
}

/**
 * Sort records by sort options
 */
function sortRecords<T extends Record<string, unknown>>(records: T[], sort: SortOption | SortOption[]): T[] {
  const sortOptions = Array.isArray(sort) ? sort : [sort]

  return [...records].sort((a, b) => {
    for (const { field, direction } of sortOptions) {
      const aVal = a[field]
      const bVal = b[field]

      if (aVal === bVal) continue

      const cmp = aVal < bVal ? -1 : 1
      return direction === 'desc' ? -cmp : cmp
    }
    return 0
  })
}

/**
 * Check if a key matches a glob pattern
 */
function matchPattern(key: string, pattern: string): boolean {
  if (!pattern || pattern === '*') return true

  // Simple glob matching: * matches any characters
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
  return regex.test(key)
}

/**
 * Generate a cursor from offset
 */
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64')
}

/**
 * Decode cursor to offset
 */
function decodeCursor(cursor: string): number {
  try {
    return parseInt(Buffer.from(cursor, 'base64').toString(), 10)
  } catch {
    return 0
  }
}

/**
 * Create the unified data namespace
 */
function createDataNamespace(storage: DataStorage): DataNamespace {
  // Notify watchers of changes
  const notifyWatchers = <T>(key: string, event: WatchEvent<T>) => {
    // Check exact key watchers
    const exactWatchers = storage.watchers.get(key)
    if (exactWatchers) {
      for (const { callback, filter } of exactWatchers) {
        if (!filter || (event.value && matchesFilter(event.value as Record<string, unknown>, filter))) {
          callback(event as WatchEvent<unknown>)
        }
      }
    }

    // Check pattern watchers
    for (const [pattern, watchers] of storage.watchers) {
      if (pattern !== key && matchPattern(key, pattern)) {
        for (const { callback, filter } of watchers) {
          if (!filter || (event.value && matchesFilter(event.value as Record<string, unknown>, filter))) {
            callback(event as WatchEvent<unknown>)
          }
        }
      }
    }
  }

  // Create query builder
  const createQueryBuilder = <T extends Record<string, unknown>>(collectionName?: string): DataQueryBuilder<T> => {
    let filter: QueryFilter<T> = {}
    let sortOptions: SortOption[] = []
    let limitValue: number | undefined
    let offsetValue: number | undefined

    const getRecords = (): T[] => {
      if (collectionName) {
        const collection = storage.collections.get(collectionName)
        if (!collection) return []
        return Array.from(collection.values()) as T[]
      }

      // Return all KV values as records
      const records: T[] = []
      const now = Date.now()
      for (const [key, entry] of storage.kv) {
        if (entry.expiresAt && entry.expiresAt < now) {
          storage.kv.delete(key)
          continue
        }
        if (typeof entry.value === 'object' && entry.value !== null) {
          records.push({ ...entry.value as T, _key: key } as T)
        }
      }
      return records
    }

    const builder: DataQueryBuilder<T> = {
      where(newFilter) {
        filter = { ...filter, ...newFilter }
        return builder
      },

      eq(field, value) {
        ;(filter as Record<string, unknown>)[field as string] = value
        return builder
      },

      gt(field, value) {
        ;(filter as Record<string, unknown>)[field as string] = { gt: value }
        return builder
      },

      gte(field, value) {
        ;(filter as Record<string, unknown>)[field as string] = { gte: value }
        return builder
      },

      lt(field, value) {
        ;(filter as Record<string, unknown>)[field as string] = { lt: value }
        return builder
      },

      lte(field, value) {
        ;(filter as Record<string, unknown>)[field as string] = { lte: value }
        return builder
      },

      in(field, values) {
        ;(filter as Record<string, unknown>)[field as string] = { in: values }
        return builder
      },

      orderBy(field, direction = 'asc') {
        sortOptions.push({ field: field as string, direction })
        return builder
      },

      limit(n) {
        limitValue = n
        return builder
      },

      offset(n) {
        offsetValue = n
        return builder
      },

      async get() {
        let results = getRecords()

        // Apply filter
        if (Object.keys(filter).length > 0) {
          results = results.filter((r) => matchesFilter(r, filter))
        }

        // Apply sort
        if (sortOptions.length > 0) {
          results = sortRecords(results, sortOptions)
        }

        // Apply offset
        if (offsetValue !== undefined && offsetValue > 0) {
          results = results.slice(offsetValue)
        }

        // Apply limit
        if (limitValue !== undefined) {
          results = results.slice(0, limitValue)
        }

        return results
      },

      async first() {
        const results = await builder.limit(1).get()
        return results[0] ?? null
      },

      async count() {
        let results = getRecords()

        if (Object.keys(filter).length > 0) {
          results = results.filter((r) => matchesFilter(r, filter))
        }

        return results.length
      },

      async paginate(options = {}) {
        const { limit = 20, cursor } = options

        let results = getRecords()

        // Apply filter
        if (Object.keys(filter).length > 0) {
          results = results.filter((r) => matchesFilter(r, filter))
        }

        // Apply sort
        if (sortOptions.length > 0) {
          results = sortRecords(results, sortOptions)
        }

        const total = results.length

        // Apply cursor/offset
        let offset = offsetValue ?? 0
        if (cursor) {
          offset = decodeCursor(cursor)
        }

        results = results.slice(offset, offset + limit)
        const hasMore = offset + limit < total

        return {
          items: results,
          total,
          hasMore,
          cursor: hasMore ? encodeCursor(offset + limit) : undefined,
        }
      },
    }

    return builder
  }

  // Create collection accessor
  const createCollection = <T extends Record<string, unknown>>(name: string): DataCollection<T> => {
    if (!storage.collections.has(name)) {
      storage.collections.set(name, new Map())
    }
    const collectionMap = storage.collections.get(name)!

    return {
      async get(key) {
        return (collectionMap.get(key) as T) ?? null
      },

      async set(key, value) {
        const existing = collectionMap.get(key) as T | undefined
        collectionMap.set(key, value)

        notifyWatchers<T>(`${name}:${key}`, {
          type: existing ? 'updated' : 'created',
          key,
          value,
          previousValue: existing,
          timestamp: Date.now(),
        })
      },

      async delete(key) {
        const existing = collectionMap.get(key) as T | undefined
        const deleted = collectionMap.delete(key)

        if (deleted && existing) {
          notifyWatchers<T>(`${name}:${key}`, {
            type: 'deleted',
            key,
            previousValue: existing,
            timestamp: Date.now(),
          })
        }

        return deleted
      },

      async has(key) {
        return collectionMap.has(key)
      },

      async list(options = {}) {
        let results = Array.from(collectionMap.values()) as T[]

        if (options.where) {
          results = results.filter((r) => matchesFilter(r, options.where!))
        }

        if (options.sort) {
          results = sortRecords(results, options.sort)
        }

        if (options.offset) {
          results = results.slice(options.offset)
        }

        if (options.limit) {
          results = results.slice(0, options.limit)
        }

        return results
      },

      query() {
        return createQueryBuilder<T>(name)
      },

      watch(callback, options = {}) {
        const watchKey = `${name}:*`

        if (!storage.watchers.has(watchKey)) {
          storage.watchers.set(watchKey, new Set())
        }

        const watcher = { callback: callback as WatchCallback<unknown>, filter: options.where }
        storage.watchers.get(watchKey)!.add(watcher)

        return {
          unsubscribe() {
            storage.watchers.get(watchKey)?.delete(watcher)
          },
        }
      },

      async count(where) {
        let results = Array.from(collectionMap.values()) as T[]

        if (where) {
          results = results.filter((r) => matchesFilter(r, where))
        }

        return results.length
      },
    }
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      const entry = storage.kv.get(key)
      if (!entry) return null

      // Check expiration
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        storage.kv.delete(key)
        return null
      }

      return entry.value as T
    },

    async set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void> {
      const existing = storage.kv.get(key)
      const expiresAt = options?.ttl ? Date.now() + options.ttl : undefined

      storage.kv.set(key, { value, expiresAt })

      notifyWatchers<T>(key, {
        type: existing ? 'updated' : 'created',
        key,
        value,
        previousValue: existing?.value as T,
        timestamp: Date.now(),
      })
    },

    async delete(key: string): Promise<boolean> {
      const existing = storage.kv.get(key)
      const deleted = storage.kv.delete(key)

      if (deleted && existing) {
        notifyWatchers(key, {
          type: 'deleted',
          key,
          previousValue: existing.value,
          timestamp: Date.now(),
        })
      }

      return deleted
    },

    async has(key: string): Promise<boolean> {
      const entry = storage.kv.get(key)
      if (!entry) return false

      // Check expiration
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        storage.kv.delete(key)
        return false
      }

      return true
    },

    async keys(pattern?: string): Promise<string[]> {
      const now = Date.now()
      const keys: string[] = []

      for (const [key, entry] of storage.kv) {
        // Check expiration
        if (entry.expiresAt && entry.expiresAt < now) {
          storage.kv.delete(key)
          continue
        }

        if (matchPattern(key, pattern ?? '*')) {
          keys.push(key)
        }
      }

      return keys
    },

    async list<T extends Record<string, unknown>>(options?: QueryOptions<T>): Promise<T[]> {
      return createQueryBuilder<T>()
        .where(options?.where ?? {})
        .get()
    },

    query<T extends Record<string, unknown>>(collectionName?: string) {
      return createQueryBuilder<T>(collectionName)
    },

    watch<T>(keyOrPattern: string, callback: WatchCallback<T>) {
      if (!storage.watchers.has(keyOrPattern)) {
        storage.watchers.set(keyOrPattern, new Set())
      }

      const watcher = { callback: callback as WatchCallback<unknown>, filter: undefined }
      storage.watchers.get(keyOrPattern)!.add(watcher)

      return {
        unsubscribe() {
          storage.watchers.get(keyOrPattern)?.delete(watcher)
        },
      }
    },

    collection<T extends Record<string, unknown>>(name: string) {
      return createCollection<T>(name)
    },
  }
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

import { createTrackContext } from './track'
import { createMeasureNamespace } from './measure'
import { createExperimentDataContext } from './experiment'
import { createGoalContext } from './goal'
import { createStreamContext } from './stream'
import { createViewContext } from './view/context'
import { createEntityEventContext } from './entity-events/entity-events'

/**
 * Create a full data context with all namespaces
 *
 * This provides the unified $ data API with:
 * - $.data - Basic CRUD and query primitives
 * - $.track - Event tracking and analytics
 * - $.measure - Time-series metrics
 * - $.experiment - A/B testing
 * - $.goal - OKR tracking
 * - $.stream - Real-time streams
 * - $.view - Materialized views
 * - $.Entity(id) - Event sourcing
 *
 * @returns Full data context with all namespaces
 */
export function createDataContext(): FullDataContext {
  // Create internal storage
  const storage: DataStorage = {
    kv: new Map(),
    collections: new Map(),
    watchers: new Map(),
  }

  // Create all namespace contexts
  const trackCtx = createTrackContext()
  const measureNs = createMeasureNamespace()
  const experimentCtx = createExperimentDataContext()
  const goalCtx = createGoalContext()
  const streamCtx = createStreamContext()
  const viewCtx = createViewContext()
  const entityCtx = createEntityEventContext()

  // Create unified data namespace
  const data = createDataNamespace(storage)

  // Create base context
  const baseContext: FullDataContext = {
    data,
    track: trackCtx.track,
    measure: measureNs,
    experiment: experimentCtx.experiment,
    goal: goalCtx.goal,
    stream: streamCtx.stream,
    view: viewCtx.view,
    _storage: storage,
  }

  // Create proxy to handle entity access ($.Order, $.Customer, etc.)
  return new Proxy(baseContext, {
    get(target, prop: string) {
      // Return known namespaces
      if (prop in target) {
        return target[prop as keyof typeof target]
      }

      // Check if this is an entity type (PascalCase)
      if (/^[A-Z]/.test(prop)) {
        // Return entity accessor from entity events context
        return entityCtx.$[prop]
      }

      return undefined
    },
  })
}

/**
 * Create a minimal data context with just the basic primitives
 * (without the specialized namespaces)
 */
export function createMinimalDataContext(): { data: DataNamespace; _storage: DataStorage } {
  const storage: DataStorage = {
    kv: new Map(),
    collections: new Map(),
    watchers: new Map(),
  }

  return {
    data: createDataNamespace(storage),
    _storage: storage,
  }
}
