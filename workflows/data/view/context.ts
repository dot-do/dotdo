/**
 * View Context Implementation
 *
 * Provides materialized views API ($.view) with:
 * - $.view.define('name', { from, groupBy, compute }) - Define materialized views
 * - $.view.X.get() - Query full view
 * - $.view.X.get(key) - Query single key
 * - $.view.X.where().limit().get() - Filtered queries
 * - $.view.X.subscribe() - Real-time updates
 * - $.view.X.refresh() - Manual refresh
 *
 * @module workflows/data/view/context
 */

// ============================================================================
// Types
// ============================================================================

/** Aggregate function descriptor */
export interface AggregateDescriptor {
  type: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'first' | 'last' | 'countDistinct'
  field?: string
}

/** Compute aggregates type */
export type ComputeAggregates = Record<string, AggregateDescriptor>

/** View definition options */
export interface ViewDefinition {
  name?: string
  from: EventSource
  groupBy: string | string[]
  compute: ComputeAggregates
  where?: (event: Record<string, unknown>) => boolean
  orderBy?: Record<string, 'asc' | 'desc'>
  limit?: number
  incremental?: boolean
  createdAt?: number
  lastRefresh?: number | null
  rowCount?: number
}

/** Event source interface */
export interface EventSource {
  _type: 'track' | 'stream'
  _event: string
}

/** View query interface */
export interface ViewQuery {
  where: (condition: Record<string, unknown> | ((row: Record<string, unknown>) => boolean)) => ViewQuery
  limit: (n: number) => ViewQuery
  offset: (n: number) => ViewQuery
  orderBy: (order: Record<string, 'asc' | 'desc'>) => ViewQuery
  get: () => Promise<Record<string, unknown>[]>
}

/** View subscription options */
export interface ViewSubscriptionOptions {
  where?: Record<string, unknown>
}

/** View subscription callbacks */
export interface ViewSubscriptionCallbacks {
  onInsert?: (row: Record<string, unknown>) => void
  onUpdate?: (before: Record<string, unknown>, after: Record<string, unknown>) => void
  onDelete?: (row: Record<string, unknown>) => void
}

/** View subscription result */
export interface ViewSubscription {
  unsubscribe: () => void
}

/** Refresh options */
export interface RefreshOptions {
  incremental?: boolean
  since?: number
}

/** Refresh result */
export interface RefreshResult {
  rowsProcessed: number
  duration: number
  timestamp: number
}

/** View info */
export interface ViewInfo {
  name: string
  groupBy: string | string[]
  computeFields: string[]
  rowCount: number
  lastRefresh: number | null
}

/** Consistency options */
export interface ConsistencyOptions {
  consistency?: 'eventual' | 'strong' | 'bounded'
  maxStaleness?: number
  includeMetadata?: boolean
}

/** Write options */
export interface WriteOptions {
  awaitViews?: string[]
}

/** Write result */
export interface WriteResult {
  viewsUpdated?: string[]
}

/** Internal storage interface */
export interface ViewStorage {
  views: Map<string, StoredViewDefinition>
  viewData: Map<string, Map<string, Record<string, unknown>>>
  events: Map<string, Record<string, unknown>[]>
  retractedEvents: Map<string, Set<string>>
  checkpoints: Map<string, number>
  disabledSources: Set<string>
}

/** Stored view with full metadata */
export interface StoredViewDefinition extends ViewDefinition {
  name: string
  createdAt: number
  lastRefresh: number | null
  rowCount: number
}

/** Track proxy type */
export interface TrackProxy {
  [event: string]: (data: Record<string, unknown>, options?: WriteOptions) => Promise<WriteResult>
}

/** Stream proxy type */
export interface StreamProxy {
  from: StreamFromProxy
  emit: (event: string, data: Record<string, unknown>) => Promise<void>
  retract: (event: string, eventId: string) => Promise<void>
}

/** Stream from proxy */
export interface StreamFromProxy {
  [namespace: string]: {
    [event: string]: EventSource
  }
}

/** View namespace type */
export interface ViewNamespace {
  define: (name: string, def: ViewDefinition) => Promise<void>
  list: () => Promise<StoredViewDefinition[]>
  [viewName: string]: ViewInstance | unknown
}

/** View instance type */
export interface ViewInstance {
  get: (key?: string | Record<string, unknown>, options?: ConsistencyOptions) => Promise<Record<string, unknown> | Record<string, unknown>[] | null>
  where: (condition: Record<string, unknown> | ((row: Record<string, unknown>) => boolean)) => ViewQuery
  limit: (n: number) => ViewQuery
  offset: (n: number) => ViewQuery
  orderBy: (order: Record<string, 'asc' | 'desc'>) => ViewQuery
  subscribe: (
    callback: ((changes: unknown) => void) | ViewSubscriptionCallbacks,
    options?: ViewSubscriptionOptions
  ) => ViewSubscription
  refresh: (options?: RefreshOptions) => Promise<RefreshResult>
  info: () => Promise<ViewInfo>
  drop: () => Promise<void>
  update: (options: Partial<ViewDefinition>) => Promise<void>
}

/** On proxy for event handlers */
export interface OnProxy {
  [namespace: string]: {
    [event: string]: (handler: (event: Record<string, unknown>) => void | Promise<void>) => void
  }
}

/** Every proxy for scheduled tasks */
export interface EveryProxy {
  hour: (handler: () => void | Promise<void>) => void
}

/** Entity proxy for triggering events */
export interface EntityProxy {
  (id: string): {
    [event: string]: (data: Record<string, unknown>) => Promise<void>
  }
}

/** Internal helpers interface */
export interface InternalHelpers {
  simulateTimePass: (ms: number) => Promise<void>
  directWrite: (source: string, data: Record<string, unknown>) => Promise<void>
  getViewStorage: (viewName: string) => Promise<Map<string, Record<string, unknown>> | null>
  refreshView: (viewName: string) => Promise<void>
  disableSource: (source: string) => void
  enableSource: (source: string) => void
  advanceTime: (ms: number) => Promise<void>
  currentTime: number
}

/** View context interface */
export interface ViewContext {
  view: ViewNamespace
  track: TrackProxy
  stream: StreamProxy
  on: OnProxy
  every: EveryProxy
  Customer: EntityProxy
  sum: (field: string) => AggregateDescriptor
  count: () => AggregateDescriptor
  avg: (field: string) => AggregateDescriptor
  min: (field: string) => AggregateDescriptor
  max: (field: string) => AggregateDescriptor
  first: (field: string) => AggregateDescriptor
  last: (field: string) => AggregateDescriptor
  countDistinct: (field: string) => AggregateDescriptor
  _storage: ViewStorage
  _internal: InternalHelpers
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a view context for testing
 */
export function createViewContext(): ViewContext {
  // Storage
  const storage: ViewStorage = {
    views: new Map(),
    viewData: new Map(),
    events: new Map(),
    retractedEvents: new Map(),
    checkpoints: new Map(),
    disabledSources: new Set(),
  }

  // Subscriptions
  const subscriptions = new Map<string, Set<{
    callback: ((changes: unknown) => void) | ViewSubscriptionCallbacks
    options?: ViewSubscriptionOptions
  }>>()

  // Event handlers
  const eventHandlers = new Map<string, Array<(event: Record<string, unknown>) => void | Promise<void>>>()

  // Scheduled tasks
  const scheduledTasks: Array<() => void | Promise<void>> = []

  // Internal time tracking - can be advanced for testing
  let currentTime = Date.now()

  // Event sequence numbers for incremental refresh tracking
  let globalEventSequence = 0
  const eventSequenceNumbers = new Map<string, number[]>()

  // Cache for view instances to enable spying
  const viewInstanceCache = new Map<string, ViewInstance>()

  // Helper to get group key
  const getGroupKey = (event: Record<string, unknown>, groupBy: string | string[]): string => {
    if (Array.isArray(groupBy)) {
      return groupBy.map(k => String(event[k] ?? 'undefined')).join(':')
    }
    return String(event[groupBy] ?? 'undefined')
  }

  // Helper to parse group key back to object
  const parseGroupKey = (key: string, groupBy: string | string[]): Record<string, unknown> => {
    if (Array.isArray(groupBy)) {
      const parts = key.split(':')
      const result: Record<string, unknown> = {}
      groupBy.forEach((k, i) => {
        result[k] = parts[i] === 'undefined' ? undefined : parts[i]
      })
      return result
    }
    return { [groupBy]: key === 'undefined' ? undefined : key }
  }

  // Helper to compute aggregates
  const computeAggregates = (
    events: Record<string, unknown>[],
    compute: ComputeAggregates,
    groupBy: string | string[]
  ): Map<string, Record<string, unknown>> => {
    const groups = new Map<string, Record<string, unknown>[]>()

    // Group events
    for (const event of events) {
      const key = getGroupKey(event, groupBy)
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(event)
    }

    // Compute aggregates for each group
    const results = new Map<string, Record<string, unknown>>()
    for (const [key, groupEvents] of groups) {
      const row: Record<string, unknown> = { ...parseGroupKey(key, groupBy) }

      for (const [fieldName, agg] of Object.entries(compute)) {
        row[fieldName] = computeAggregate(groupEvents, agg)
      }

      results.set(key, row)
    }

    return results
  }

  // Helper to compute a single aggregate
  const computeAggregate = (events: Record<string, unknown>[], agg: AggregateDescriptor): unknown => {
    switch (agg.type) {
      case 'count':
        return events.length

      case 'sum': {
        let sum = 0
        for (const e of events) {
          const val = e[agg.field!]
          if (val !== null && val !== undefined) {
            const num = typeof val === 'string' ? parseFloat(val) : val
            if (typeof num === 'number' && !isNaN(num)) {
              sum += num
            }
          }
        }
        return sum
      }

      case 'avg': {
        let sum = 0
        let count = 0
        for (const e of events) {
          const val = e[agg.field!]
          if (val !== null && val !== undefined) {
            const num = typeof val === 'string' ? parseFloat(val) : val
            if (typeof num === 'number' && !isNaN(num)) {
              sum += num
              count++
            }
          }
        }
        return count > 0 ? sum / count : 0
      }

      case 'min': {
        let min = Infinity
        for (const e of events) {
          const val = e[agg.field!]
          if (val !== null && val !== undefined && typeof val === 'number' && val < min) {
            min = val
          }
        }
        return min === Infinity ? 0 : min
      }

      case 'max': {
        let max = -Infinity
        for (const e of events) {
          const val = e[agg.field!]
          if (val !== null && val !== undefined && typeof val === 'number' && val > max) {
            max = val
          }
        }
        return max === -Infinity ? 0 : max
      }

      case 'first': {
        for (const e of events) {
          const val = e[agg.field!]
          if (val !== undefined) {
            return val
          }
        }
        return undefined
      }

      case 'last': {
        for (let i = events.length - 1; i >= 0; i--) {
          const val = events[i][agg.field!]
          if (val !== undefined) {
            return val
          }
        }
        return undefined
      }

      case 'countDistinct': {
        const seen = new Set<unknown>()
        for (const e of events) {
          const val = e[agg.field!]
          if (val !== undefined) {
            seen.add(val)
          }
        }
        return seen.size
      }

      default:
        return 0
    }
  }

  // Helper to notify subscribers
  const notifySubscribers = (
    viewName: string,
    changes: {
      type: 'insert' | 'update' | 'delete'
      before?: Record<string, unknown>
      after?: Record<string, unknown>
      row?: Record<string, unknown>
    }
  ) => {
    const subs = subscriptions.get(viewName)
    if (!subs) return

    for (const sub of subs) {
      // Check filter
      if (sub.options?.where) {
        const row = changes.after ?? changes.row
        if (row && !matchesFilter(row, sub.options.where)) {
          continue
        }
      }

      if (typeof sub.callback === 'function') {
        const payload = changes.after ?? changes.row ?? changes
        sub.callback(payload)
      } else {
        if (changes.type === 'insert' && sub.callback.onInsert) {
          sub.callback.onInsert(changes.row!)
        } else if (changes.type === 'update' && sub.callback.onUpdate) {
          sub.callback.onUpdate(changes.before!, changes.after!)
        } else if (changes.type === 'delete' && sub.callback.onDelete) {
          sub.callback.onDelete(changes.row!)
        }
      }
    }
  }

  // Helper to match filter conditions
  const matchesFilter = (row: Record<string, unknown>, condition: Record<string, unknown>): boolean => {
    for (const [key, value] of Object.entries(condition)) {
      const rowValue = row[key]

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const ops = value as Record<string, unknown>
        for (const [op, opValue] of Object.entries(ops)) {
          switch (op) {
            case 'gt':
              if (!(typeof rowValue === 'number' && rowValue > (opValue as number))) return false
              break
            case 'gte':
              if (!(typeof rowValue === 'number' && rowValue >= (opValue as number))) return false
              break
            case 'lt':
              if (!(typeof rowValue === 'number' && rowValue < (opValue as number))) return false
              break
            case 'lte':
              if (!(typeof rowValue === 'number' && rowValue <= (opValue as number))) return false
              break
            case 'ne':
              if (rowValue === opValue) return false
              break
            case 'in':
              if (!Array.isArray(opValue) || !opValue.includes(rowValue)) return false
              break
          }
        }
      } else {
        if (rowValue !== value) return false
      }
    }
    return true
  }

  // Helper to update view data
  const updateViewData = async (
    viewName: string,
    viewDef: StoredViewDefinition,
    newEvents: Record<string, unknown>[]
  ) => {
    if (!storage.viewData.has(viewName)) {
      storage.viewData.set(viewName, new Map())
    }
    const data = storage.viewData.get(viewName)!

    for (const event of newEvents) {
      // Check where filter
      if (viewDef.where && !viewDef.where(event)) {
        continue
      }

      const key = getGroupKey(event, viewDef.groupBy)
      const existing = data.get(key)

      if (existing) {
        // Update existing row
        const before = { ...existing }

        // Re-compute aggregates for this group
        const sourceKey = `${viewDef.from._type}.${viewDef.from._event}`
        const allEvents = storage.events.get(sourceKey) ?? []
        const groupEvents = allEvents.filter(e => {
          if (viewDef.where && !viewDef.where(e)) return false
          return getGroupKey(e, viewDef.groupBy) === key
        })

        const newRow: Record<string, unknown> = { ...parseGroupKey(key, viewDef.groupBy) }
        for (const [fieldName, agg] of Object.entries(viewDef.compute)) {
          newRow[fieldName] = computeAggregate(groupEvents, agg)
        }

        data.set(key, newRow)
        notifySubscribers(viewName, { type: 'update', before, after: newRow })
      } else {
        // Insert new row
        const sourceKey = `${viewDef.from._type}.${viewDef.from._event}`
        const allEvents = storage.events.get(sourceKey) ?? []
        const groupEvents = allEvents.filter(e => {
          if (viewDef.where && !viewDef.where(e)) return false
          return getGroupKey(e, viewDef.groupBy) === key
        })

        const newRow: Record<string, unknown> = { ...parseGroupKey(key, viewDef.groupBy) }
        for (const [fieldName, agg] of Object.entries(viewDef.compute)) {
          newRow[fieldName] = computeAggregate(groupEvents, agg)
        }

        data.set(key, newRow)
        notifySubscribers(viewName, { type: 'insert', row: newRow })
      }
    }

    // Update row count
    viewDef.rowCount = data.size
  }

  // Helper to refresh view
  const refreshView = async (viewName: string, options?: RefreshOptions): Promise<RefreshResult> => {
    const viewDef = storage.views.get(viewName)
    if (!viewDef) {
      throw new Error(`View '${viewName}' not found`)
    }

    const start = Date.now()

    // Get source key
    const sourceKey = viewDef.from._type === 'track'
      ? `track.${viewDef.from._event}`
      : `stream.${viewDef.from._event}`

    // Check if source is disabled
    if (storage.disabledSources.has(sourceKey)) {
      throw new Error(`Source '${sourceKey}' is unavailable`)
    }

    // Get events
    const allEvents = storage.events.get(sourceKey) ?? []
    const sequences = eventSequenceNumbers.get(sourceKey) ?? []
    let events: Record<string, unknown>[] = []

    // Filter by time if incremental
    if (options?.incremental) {
      if (options.since !== undefined) {
        // User provided explicit since timestamp - filter by event's timestamp field
        for (const event of allEvents) {
          const eventTs = (event.timestamp as number) ?? 0
          if (eventTs >= options.since) {
            events.push(event)
          }
        }
      } else {
        // No explicit since - use checkpoint (last processed sequence number)
        const checkpoint = storage.checkpoints.get(viewName) ?? 0
        for (let i = 0; i < allEvents.length; i++) {
          const seq = sequences[i] ?? 0
          if (seq > checkpoint) {
            events.push(allEvents[i])
          }
        }
      }
    } else {
      events = [...allEvents]
    }

    // Apply where filter
    if (viewDef.where) {
      events = events.filter(viewDef.where)
    }

    // Compute new data
    const newData = computeAggregates(events, viewDef.compute, viewDef.groupBy)

    // If not incremental, clear existing data
    if (!options?.incremental) {
      storage.viewData.set(viewName, newData)
    } else {
      // Merge with existing
      const existing = storage.viewData.get(viewName) ?? new Map()
      for (const [key, row] of newData) {
        existing.set(key, row)
      }
      storage.viewData.set(viewName, existing)
    }

    // Update metadata
    viewDef.lastRefresh = Date.now()
    viewDef.rowCount = storage.viewData.get(viewName)?.size ?? 0

    // Update checkpoint to current global sequence number
    storage.checkpoints.set(viewName, globalEventSequence)

    return {
      rowsProcessed: events.length,
      duration: Date.now() - start,
      timestamp: Date.now(),
    }
  }

  // Create view query builder
  const createQueryBuilder = (viewName: string): ViewQuery => {
    let whereCondition: Record<string, unknown> | ((row: Record<string, unknown>) => boolean) | null = null
    let limitValue: number | null = null
    let offsetValue: number | null = null
    let orderByValue: Record<string, 'asc' | 'desc'> | null = null

    const query: ViewQuery = {
      where(condition) {
        whereCondition = condition
        return query
      },
      limit(n) {
        limitValue = n
        return query
      },
      offset(n) {
        offsetValue = n
        return query
      },
      orderBy(order) {
        orderByValue = order
        return query
      },
      async get() {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found`)
        }

        const data = storage.viewData.get(viewName) ?? new Map()
        let results = Array.from(data.values())

        // Apply where filter
        if (whereCondition) {
          if (typeof whereCondition === 'function') {
            results = results.filter(whereCondition)
          } else {
            results = results.filter(row => matchesFilter(row, whereCondition as Record<string, unknown>))
          }
        }

        // Apply orderBy (query override or view default)
        const orderBy = orderByValue ?? viewDef.orderBy
        if (orderBy) {
          results.sort((a, b) => {
            for (const [field, dir] of Object.entries(orderBy)) {
              const aVal = a[field] as number
              const bVal = b[field] as number
              if (aVal !== bVal) {
                return dir === 'asc' ? aVal - bVal : bVal - aVal
              }
            }
            return 0
          })
        }

        // Apply offset
        if (offsetValue !== null && offsetValue > 0) {
          results = results.slice(offsetValue)
        }

        // Apply limit (query override or view default)
        const limit = limitValue ?? viewDef.limit
        if (limit !== null && limit !== undefined) {
          results = results.slice(0, limit)
        }

        return results
      },
    }

    return query
  }

  // Create view instance
  const createViewInstance = (viewName: string): ViewInstance => {
    return {
      async get(key, options) {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found`)
        }

        // Handle strong consistency
        if (options?.consistency === 'strong') {
          await refreshView(viewName)
        }

        const data = storage.viewData.get(viewName) ?? new Map()

        // Single key lookup - including undefined which maps to 'undefined' string key
        let lookupKey: string | null = null
        if (key === undefined) {
          // Check if there's data with 'undefined' as key (from events with missing group keys)
          // If so, treat as single key lookup, otherwise return all rows
          if (data.has('undefined')) {
            lookupKey = 'undefined'
          }
        } else if (typeof key === 'object' && key !== null) {
          // Composite key
          lookupKey = getGroupKey(key, viewDef.groupBy)
        } else if (key !== undefined) {
          lookupKey = String(key)
        }

        if (lookupKey === null) {
          // Return all rows
          let results = Array.from(data.values())

          // Apply orderBy
          if (viewDef.orderBy) {
            results.sort((a, b) => {
              for (const [field, dir] of Object.entries(viewDef.orderBy!)) {
                const aVal = a[field] as number
                const bVal = b[field] as number
                if (aVal !== bVal) {
                  return dir === 'asc' ? aVal - bVal : bVal - aVal
                }
              }
              return 0
            })
          }

          // Apply limit
          if (viewDef.limit) {
            results = results.slice(0, viewDef.limit)
          }

          return results
        }

        const row = data.get(lookupKey) ?? null

        // Add metadata if requested
        if (options?.includeMetadata && row) {
          return {
            ...row,
            _metadata: {
              staleness: Date.now() - (viewDef.lastRefresh ?? 0),
            },
          }
        }

        return row
      },

      where(condition) {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found`)
        }
        return createQueryBuilder(viewName).where(condition)
      },

      limit(n) {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found`)
        }
        return createQueryBuilder(viewName).limit(n)
      },

      offset(n) {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found`)
        }
        return createQueryBuilder(viewName).offset(n)
      },

      orderBy(order) {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found`)
        }
        return createQueryBuilder(viewName).orderBy(order)
      },

      subscribe(callback, options) {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found or undefined`)
        }

        if (!subscriptions.has(viewName)) {
          subscriptions.set(viewName, new Set())
        }

        const sub = { callback, options }
        subscriptions.get(viewName)!.add(sub)

        return {
          unsubscribe() {
            subscriptions.get(viewName)?.delete(sub)
          },
        }
      },

      async refresh(options) {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found`)
        }
        return refreshView(viewName, options)
      },

      async info() {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found`)
        }

        return {
          name: viewDef.name,
          groupBy: viewDef.groupBy,
          computeFields: Object.keys(viewDef.compute),
          rowCount: viewDef.rowCount,
          lastRefresh: viewDef.lastRefresh,
        }
      },

      async drop() {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found`)
        }

        storage.views.delete(viewName)
        storage.viewData.delete(viewName)
        subscriptions.delete(viewName)
      },

      async update(options) {
        const viewDef = storage.views.get(viewName)
        if (!viewDef) {
          throw new Error(`View '${viewName}' not found`)
        }

        // Update definition
        if (options.compute) {
          viewDef.compute = options.compute
        }
        if (options.orderBy !== undefined) {
          viewDef.orderBy = options.orderBy
        }
        if (options.limit !== undefined) {
          viewDef.limit = options.limit
        }
        if (options.where !== undefined) {
          viewDef.where = options.where
        }

        // Trigger refresh
        await internalHelpers.refreshView(viewName)
      },
    }
  }

  // Internal helpers
  const internalHelpers: InternalHelpers = {
    get currentTime() {
      return currentTime
    },

    async simulateTimePass(ms) {
      currentTime += ms

      // Temporarily patch Date.now to return simulated time
      const originalDateNow = Date.now
      Date.now = () => currentTime

      try {
        // Check for expiring views
        for (const [viewName, viewDef] of storage.views) {
          if (viewDef.where) {
            const data = storage.viewData.get(viewName) ?? new Map()
            const sourceKey = `${viewDef.from._type}.${viewDef.from._event}`
            const allEvents = storage.events.get(sourceKey) ?? []

            // Re-evaluate which rows should still exist
            for (const [key, row] of data) {
              const groupEvents = allEvents.filter(e => {
                return getGroupKey(e, viewDef.groupBy) === key && viewDef.where!(e)
              })

              if (groupEvents.length === 0) {
                // Row should be deleted
                data.delete(key)
                notifySubscribers(viewName, { type: 'delete', row })
              }
            }
          }
        }
      } finally {
        // Restore original Date.now
        Date.now = originalDateNow
      }
    },

    async directWrite(source, data) {
      if (!storage.events.has(source)) {
        storage.events.set(source, [])
      }
      storage.events.get(source)!.push(data)
    },

    async getViewStorage(viewName) {
      if (!storage.views.has(viewName)) {
        return null
      }
      return storage.viewData.get(viewName) ?? null
    },

    async refreshView(viewName) {
      await refreshView(viewName)
    },

    disableSource(source) {
      storage.disabledSources.add(source)
    },

    enableSource(source) {
      storage.disabledSources.delete(source)
    },

    async advanceTime(ms) {
      currentTime += ms

      // Trigger scheduled tasks
      for (const task of scheduledTasks) {
        await task()
      }
    },
  }

  // Create track proxy
  const trackProxy = new Proxy({} as TrackProxy, {
    get(_, eventName: string) {
      // Return event source for view definitions
      if (eventName.startsWith('_')) {
        return undefined
      }

      // Create callable that also acts as event source
      const eventSource: EventSource & ((data: Record<string, unknown>, options?: WriteOptions) => Promise<WriteResult>) =
        Object.assign(
          async (data: Record<string, unknown>, options?: WriteOptions): Promise<WriteResult> => {
            const sourceKey = `track.${eventName}`

            if (!storage.events.has(sourceKey)) {
              storage.events.set(sourceKey, [])
            }
            storage.events.get(sourceKey)!.push(data)

            // Record event sequence number (for incremental refresh)
            if (!eventSequenceNumbers.has(sourceKey)) {
              eventSequenceNumbers.set(sourceKey, [])
            }
            eventSequenceNumbers.get(sourceKey)!.push(++globalEventSequence)

            const result: WriteResult = {}

            // Update relevant views - always update all matching views
            const viewsUpdated: string[] = []
            for (const [viewName, viewDef] of storage.views) {
              if (viewDef.from._event === eventName && viewDef.from._type === 'track') {
                await updateViewData(viewName, viewDef, [data])
                viewsUpdated.push(viewName)
              }
            }

            if (options?.awaitViews) {
              result.viewsUpdated = viewsUpdated
            }

            return result
          },
          {
            _type: 'track' as const,
            _event: eventName,
          }
        )

      return eventSource
    },
  })

  // Create stream proxy
  const streamProxy: StreamProxy = {
    from: new Proxy({} as StreamFromProxy, {
      get(_, namespace: string) {
        return new Proxy({}, {
          get(_, event: string) {
            return {
              _type: 'stream' as const,
              _event: `${namespace}.${event}`,
            }
          },
        })
      },
    }),

    async emit(event: string, data: Record<string, unknown>) {
      const sourceKey = `stream.${event}`

      if (!storage.events.has(sourceKey)) {
        storage.events.set(sourceKey, [])
      }
      storage.events.get(sourceKey)!.push(data)

      // Update relevant views - always update all matching views
      for (const [viewName, viewDef] of storage.views) {
        if (viewDef.from._event === event && viewDef.from._type === 'stream') {
          await updateViewData(viewName, viewDef, [data])
        }
      }
    },

    async retract(event: string, eventId: string) {
      const sourceKey = `stream.${event}`

      if (!storage.retractedEvents.has(sourceKey)) {
        storage.retractedEvents.set(sourceKey, new Set())
      }
      storage.retractedEvents.get(sourceKey)!.add(eventId)

      // Remove the event from storage
      const events = storage.events.get(sourceKey) ?? []
      const idx = events.findIndex(e => e.eventId === eventId)
      if (idx !== -1) {
        const removedEvent = events[idx]
        events.splice(idx, 1)

        // Update views
        for (const [viewName, viewDef] of storage.views) {
          if (viewDef.from._event === event && viewDef.from._type === 'stream') {
            // Recalculate the affected group
            const key = getGroupKey(removedEvent, viewDef.groupBy)
            const groupEvents = events.filter(e => getGroupKey(e, viewDef.groupBy) === key)

            const data = storage.viewData.get(viewName) ?? new Map()

            if (groupEvents.length === 0) {
              data.delete(key)
            } else {
              const newRow: Record<string, unknown> = { ...parseGroupKey(key, viewDef.groupBy) }
              for (const [fieldName, agg] of Object.entries(viewDef.compute)) {
                newRow[fieldName] = computeAggregate(groupEvents, agg)
              }
              data.set(key, newRow)
            }
          }
        }
      }
    },
  }

  // Create on proxy
  const onProxy = new Proxy({} as OnProxy, {
    get(_, namespace: string) {
      return new Proxy({}, {
        get(_, event: string) {
          return (handler: (event: Record<string, unknown>) => void | Promise<void>) => {
            const key = `${namespace}.${event}`
            if (!eventHandlers.has(key)) {
              eventHandlers.set(key, [])
            }
            eventHandlers.get(key)!.push(handler)
          }
        },
      })
    },
  })

  // Create every proxy
  const everyProxy: EveryProxy = {
    hour(handler) {
      scheduledTasks.push(handler)
    },
  }

  // Create entity proxy
  const createEntityProxy = (entityType: string): EntityProxy => {
    return (id: string) => {
      return new Proxy({}, {
        get(_, event: string) {
          return async (data: Record<string, unknown>) => {
            const key = `${entityType}.${event}`
            const handlers = eventHandlers.get(key) ?? []
            for (const handler of handlers) {
              await handler({ ...data, userId: id, [entityType.toLowerCase() + 'Id']: id })
            }
          }
        },
      })
    }
  }

  // Create view namespace
  const viewNamespace = new Proxy({
    async define(name: string, def: ViewDefinition) {
      // Validate name
      if (!name || name.length === 0) {
        throw new Error('View name cannot be empty')
      }
      if (/\s/.test(name)) {
        throw new Error('Invalid view name: cannot contain spaces')
      }

      // Validate required fields
      if (!def.groupBy) {
        throw new Error('View definition must include groupBy')
      }
      if (!def.compute) {
        throw new Error('View definition must include compute')
      }

      // Check for duplicates
      if (storage.views.has(name)) {
        throw new Error(`View '${name}' already exists`)
      }

      // Store the view
      const storedDef: StoredViewDefinition = {
        ...def,
        name,
        createdAt: Date.now(),
        lastRefresh: null,
        rowCount: 0,
      }
      storage.views.set(name, storedDef)

      // Initialize data storage
      storage.viewData.set(name, new Map())
    },

    async list() {
      return Array.from(storage.views.values())
    },
  } as ViewNamespace, {
    get(target, prop: string) {
      if (prop === 'define' || prop === 'list') {
        return target[prop as keyof typeof target]
      }

      // Return cached view instance (or create new one)
      if (!viewInstanceCache.has(prop)) {
        viewInstanceCache.set(prop, createViewInstance(prop))
      }
      return viewInstanceCache.get(prop)!
    },
  })

  // Create context
  const context: ViewContext = {
    view: viewNamespace,
    track: trackProxy,
    stream: streamProxy,
    on: onProxy,
    every: everyProxy,
    Customer: createEntityProxy('Customer'),
    _storage: storage,
    _internal: internalHelpers,

    // Aggregate functions
    sum: (field: string): AggregateDescriptor => ({ type: 'sum', field }),
    count: (): AggregateDescriptor => ({ type: 'count' }),
    avg: (field: string): AggregateDescriptor => ({ type: 'avg', field }),
    min: (field: string): AggregateDescriptor => ({ type: 'min', field }),
    max: (field: string): AggregateDescriptor => ({ type: 'max', field }),
    first: (field: string): AggregateDescriptor => ({ type: 'first', field }),
    last: (field: string): AggregateDescriptor => ({ type: 'last', field }),
    countDistinct: (field: string): AggregateDescriptor => ({ type: 'countDistinct', field }),
  }

  return context
}
