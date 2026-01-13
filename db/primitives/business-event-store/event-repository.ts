/**
 * EventRepository - Storage abstraction with compound indexes for 5W+H queries
 *
 * Provides efficient multi-dimensional querying for business events:
 * - Compound indexes for each 5W+H dimension
 * - Storage backends: In-memory, SQLite, DO storage
 * - Query builder for multi-dimensional queries
 * - Cursor-based pagination for efficient retrieval
 * - Time-range optimizations with B-tree style indexing
 *
 * @module db/primitives/business-event-store/event-repository
 */

import type { BusinessEvent, EventQuery, QueryOptions, EventType, EventAction, EventLinkType } from './index'

// =============================================================================
// Storage Backend Types
// =============================================================================

/**
 * Storage backend types supported
 */
export type StorageBackendType = 'memory' | 'sqlite' | 'do-storage'

/**
 * SQLite-compatible connection interface
 */
export interface SQLiteConnection {
  exec(sql: string): void
  prepare(sql: string): SQLiteStatement
  transaction<T>(fn: () => T): T
}

/**
 * SQLite prepared statement interface
 */
export interface SQLiteStatement {
  run(...params: unknown[]): void
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  bind(...params: unknown[]): SQLiteStatement
}

/**
 * DO Storage interface (Cloudflare Durable Objects)
 */
export interface DOStorageInterface {
  get<T>(key: string): Promise<T | undefined>
  get<T>(keys: string[]): Promise<Map<string, T>>
  put<T>(key: string, value: T): Promise<void>
  put<T>(entries: Map<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  list<T>(options?: { prefix?: string; start?: string; end?: string; limit?: number; reverse?: boolean }): Promise<Map<string, T>>
}

/**
 * Storage backend configuration
 */
export interface StorageBackendConfig {
  type: StorageBackendType
  sqlite?: SQLiteConnection
  doStorage?: DOStorageInterface
}

// =============================================================================
// Index Types
// =============================================================================

/**
 * Index entry for efficient lookups
 */
export interface IndexEntry {
  eventId: string
  timestamp: number
}

/**
 * Compound index key for multi-dimensional queries
 */
export interface CompoundIndexKey {
  what?: string
  when?: number
  where?: string
  why?: string
  who?: string
  how?: string
  type?: EventType
}

/**
 * Cursor for pagination
 */
export interface EventCursor {
  /** Last seen event ID */
  eventId: string
  /** Last seen timestamp for ordering */
  timestamp: number
  /** Additional cursor data for compound index positioning */
  indexPosition?: Record<string, string | number>
}

/**
 * Paginated query result
 */
export interface PaginatedResult<T> {
  items: T[]
  cursor?: EventCursor
  hasMore: boolean
  total?: number
}

/**
 * Extended query options with cursor support
 */
export interface CursorQueryOptions extends QueryOptions {
  /** Cursor for pagination (replaces offset) */
  cursor?: EventCursor
  /** Include total count (expensive for large datasets) */
  includeTotal?: boolean
}

// =============================================================================
// Query Builder Types
// =============================================================================

/**
 * Query builder for fluent multi-dimensional queries
 */
export interface EventQueryBuilder {
  // 5W+H dimension filters
  what(objectId: string | string[]): EventQueryBuilder
  whatPrefix(prefix: string): EventQueryBuilder
  when(range: { gte?: Date; lte?: Date }): EventQueryBuilder
  where(location: string | string[]): EventQueryBuilder
  why(businessStep: string | string[]): EventQueryBuilder
  who(party: string | string[]): EventQueryBuilder
  how(disposition: string | string[]): EventQueryBuilder

  // Event type filters
  type(eventType: EventType | EventType[]): EventQueryBuilder
  action(action: EventAction | EventAction[]): EventQueryBuilder

  // Pagination
  limit(n: number): EventQueryBuilder
  cursor(cursor: EventCursor): EventQueryBuilder

  // Ordering
  orderBy(field: 'when' | 'recordTime', direction?: 'asc' | 'desc'): EventQueryBuilder

  // Execute
  execute(): Promise<PaginatedResult<BusinessEvent>>
  count(): Promise<number>
}

// =============================================================================
// EventRepository Interface
// =============================================================================

/**
 * EventRepository interface for storage abstraction
 */
export interface EventRepository {
  // Storage operations
  store(event: BusinessEvent): Promise<void>
  storeBatch(events: BusinessEvent[]): Promise<void>
  get(id: string): Promise<BusinessEvent | null>
  delete(id: string): Promise<boolean>

  // Query operations
  query(query: EventQuery, options?: CursorQueryOptions): Promise<PaginatedResult<BusinessEvent>>
  queryBuilder(): EventQueryBuilder

  // Index operations
  rebuildIndexes(): Promise<void>
  getIndexStats(): Promise<IndexStats>

  // Storage backend
  getBackendType(): StorageBackendType
}

/**
 * Index statistics
 */
export interface IndexStats {
  totalEvents: number
  indexedDimensions: {
    what: number
    when: number
    where: number
    why: number
    who: number
    how: number
    type: number
  }
  lastUpdated: Date
}

// =============================================================================
// B-Tree Style Index Implementation
// =============================================================================

/**
 * B-tree style index node for efficient range queries
 */
interface BTreeNode<K, V> {
  keys: K[]
  values: V[][]
  children: BTreeNode<K, V>[] | null
  isLeaf: boolean
}

/**
 * Simple B-tree implementation for time-range indexing
 */
class BTreeIndex<K extends number | string, V> {
  private root: BTreeNode<K, V>
  private order: number
  private compareFn: (a: K, b: K) => number

  constructor(order: number = 64, compareFn?: (a: K, b: K) => number) {
    this.order = order
    this.compareFn = compareFn ?? ((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    this.root = { keys: [], values: [], children: null, isLeaf: true }
  }

  insert(key: K, value: V): void {
    const idx = this.findInsertIndex(this.root.keys, key)

    if (idx < this.root.keys.length && this.compareFn(this.root.keys[idx]!, key) === 0) {
      // Key exists, append to values
      this.root.values[idx]!.push(value)
    } else {
      // Insert new key-value pair
      this.root.keys.splice(idx, 0, key)
      this.root.values.splice(idx, 0, [value])
    }

    // Simple implementation - doesn't split nodes for now
    // A full implementation would split when keys.length > order
  }

  range(start?: K, end?: K): V[] {
    const result: V[] = []
    this.rangeSearch(this.root, start, end, result)
    return result
  }

  get(key: K): V[] {
    const idx = this.binarySearch(this.root.keys, key)
    if (idx >= 0) {
      return this.root.values[idx]!
    }
    return []
  }

  remove(key: K, value: V): boolean {
    const idx = this.binarySearch(this.root.keys, key)
    if (idx >= 0) {
      const values = this.root.values[idx]!
      const valueIdx = values.indexOf(value)
      if (valueIdx >= 0) {
        values.splice(valueIdx, 1)
        if (values.length === 0) {
          this.root.keys.splice(idx, 1)
          this.root.values.splice(idx, 1)
        }
        return true
      }
    }
    return false
  }

  size(): number {
    return this.root.keys.length
  }

  private rangeSearch(node: BTreeNode<K, V>, start: K | undefined, end: K | undefined, result: V[]): void {
    const startIdx = start !== undefined ? this.findInsertIndex(node.keys, start) : 0
    const endIdx = end !== undefined ? this.findEndIndex(node.keys, end) : node.keys.length

    for (let i = startIdx; i < endIdx; i++) {
      result.push(...node.values[i]!)
    }
  }

  private findInsertIndex(keys: K[], key: K): number {
    let left = 0
    let right = keys.length
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (this.compareFn(keys[mid]!, key) < 0) {
        left = mid + 1
      } else {
        right = mid
      }
    }
    return left
  }

  private findEndIndex(keys: K[], key: K): number {
    let left = 0
    let right = keys.length
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (this.compareFn(keys[mid]!, key) <= 0) {
        left = mid + 1
      } else {
        right = mid
      }
    }
    return left
  }

  private binarySearch(keys: K[], key: K): number {
    let left = 0
    let right = keys.length - 1
    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const cmp = this.compareFn(keys[mid]!, key)
      if (cmp === 0) return mid
      if (cmp < 0) left = mid + 1
      else right = mid - 1
    }
    return -1
  }
}

// =============================================================================
// In-Memory Event Repository Implementation
// =============================================================================

/**
 * In-memory event repository with compound indexes
 */
class InMemoryEventRepository implements EventRepository {
  // Primary storage
  private events: Map<string, BusinessEvent> = new Map()

  // Compound indexes for each 5W+H dimension
  private byWhat: Map<string, Set<string>> = new Map() // objectId -> eventIds
  private byWhen: BTreeIndex<number, string> = new BTreeIndex() // timestamp -> eventIds
  private byWhere: Map<string, Set<string>> = new Map() // location -> eventIds
  private byWhy: Map<string, Set<string>> = new Map() // businessStep -> eventIds
  private byWho: Map<string, Set<string>> = new Map() // party -> eventIds
  private byHow: Map<string, Set<string>> = new Map() // disposition -> eventIds
  private byType: Map<EventType, Set<string>> = new Map() // eventType -> eventIds
  private byAction: Map<EventAction, Set<string>> = new Map() // action -> eventIds

  // Compound indexes for common query patterns
  private byWhatWhen: Map<string, BTreeIndex<number, string>> = new Map() // objectId -> (timestamp -> eventIds)
  private byWhereWhen: Map<string, BTreeIndex<number, string>> = new Map() // location -> (timestamp -> eventIds)
  private byWhyWhen: Map<string, BTreeIndex<number, string>> = new Map() // businessStep -> (timestamp -> eventIds)

  // Statistics tracking
  private lastIndexUpdate: Date = new Date()

  async store(event: BusinessEvent): Promise<void> {
    // Store primary event
    this.events.set(event.id, event)

    // Index by What (object IDs)
    for (const objectId of event.what) {
      this.addToSetIndex(this.byWhat, objectId, event.id)

      // Compound index: what + when
      if (!this.byWhatWhen.has(objectId)) {
        this.byWhatWhen.set(objectId, new BTreeIndex())
      }
      this.byWhatWhen.get(objectId)!.insert(event.when.getTime(), event.id)
    }

    // Index by When (timestamp B-tree)
    this.byWhen.insert(event.when.getTime(), event.id)

    // Index by Where (location)
    if (event.where) {
      this.addToSetIndex(this.byWhere, event.where, event.id)

      // Compound index: where + when
      if (!this.byWhereWhen.has(event.where)) {
        this.byWhereWhen.set(event.where, new BTreeIndex())
      }
      this.byWhereWhen.get(event.where)!.insert(event.when.getTime(), event.id)
    }

    // Index by Why (business step)
    if (event.why) {
      this.addToSetIndex(this.byWhy, event.why, event.id)

      // Compound index: why + when
      if (!this.byWhyWhen.has(event.why)) {
        this.byWhyWhen.set(event.why, new BTreeIndex())
      }
      this.byWhyWhen.get(event.why)!.insert(event.when.getTime(), event.id)
    }

    // Index by Who (party)
    if (event.who) {
      this.addToSetIndex(this.byWho, event.who, event.id)
    }

    // Index by How (disposition)
    if (event.how) {
      this.addToSetIndex(this.byHow, event.how, event.id)
    }

    // Index by Type
    this.addToSetIndex(this.byType, event.type, event.id)

    // Index by Action
    if (event.action) {
      this.addToSetIndex(this.byAction, event.action, event.id)
    }

    this.lastIndexUpdate = new Date()
  }

  async storeBatch(events: BusinessEvent[]): Promise<void> {
    for (const event of events) {
      await this.store(event)
    }
  }

  async get(id: string): Promise<BusinessEvent | null> {
    return this.events.get(id) ?? null
  }

  async delete(id: string): Promise<boolean> {
    const event = this.events.get(id)
    if (!event) return false

    // Remove from primary storage
    this.events.delete(id)

    // Remove from all indexes
    for (const objectId of event.what) {
      this.removeFromSetIndex(this.byWhat, objectId, id)
      const whatWhenIndex = this.byWhatWhen.get(objectId)
      if (whatWhenIndex) {
        whatWhenIndex.remove(event.when.getTime(), id)
      }
    }

    this.byWhen.remove(event.when.getTime(), id)

    if (event.where) {
      this.removeFromSetIndex(this.byWhere, event.where, id)
      const whereWhenIndex = this.byWhereWhen.get(event.where)
      if (whereWhenIndex) {
        whereWhenIndex.remove(event.when.getTime(), id)
      }
    }

    if (event.why) {
      this.removeFromSetIndex(this.byWhy, event.why, id)
      const whyWhenIndex = this.byWhyWhen.get(event.why)
      if (whyWhenIndex) {
        whyWhenIndex.remove(event.when.getTime(), id)
      }
    }

    if (event.who) {
      this.removeFromSetIndex(this.byWho, event.who, id)
    }

    if (event.how) {
      this.removeFromSetIndex(this.byHow, event.how, id)
    }

    this.removeFromSetIndex(this.byType, event.type, id)

    if (event.action) {
      this.removeFromSetIndex(this.byAction, event.action, id)
    }

    this.lastIndexUpdate = new Date()
    return true
  }

  async query(query: EventQuery, options?: CursorQueryOptions): Promise<PaginatedResult<BusinessEvent>> {
    let candidateIds: Set<string> | null = null

    // Optimize: Use compound indexes when possible
    if (query.what && query.when) {
      candidateIds = this.queryWhatWhen(query.what, query.when)
    } else if (query.where && query.when) {
      candidateIds = this.queryWhereWhen(query.where, query.when)
    } else if (query.why && query.when) {
      candidateIds = this.queryWhyWhen(query.why, query.when)
    } else {
      // Fall back to single-dimension indexes
      candidateIds = this.querySingleDimensions(query)
    }

    // Get candidate events
    let events: BusinessEvent[] = []
    for (const id of candidateIds) {
      const event = this.events.get(id)
      if (event) {
        events.push(event)
      }
    }

    // Apply remaining filters
    events = this.applyFilters(events, query)

    // Sort by time
    const orderDirection = options?.orderDirection ?? 'desc'
    events.sort((a, b) => {
      const timeA = a.when.getTime()
      const timeB = b.when.getTime()
      return orderDirection === 'desc' ? timeB - timeA : timeA - timeB
    })

    // Apply cursor pagination
    if (options?.cursor) {
      const cursorIndex = events.findIndex(
        (e) => e.id === options.cursor!.eventId
      )
      if (cursorIndex >= 0) {
        events = events.slice(cursorIndex + 1)
      }
    }

    // Calculate total if requested
    const total = options?.includeTotal ? events.length : undefined

    // Apply limit
    const limit = options?.limit ?? 100
    const hasMore = events.length > limit
    events = events.slice(0, limit)

    // Build cursor for next page
    const cursor = events.length > 0 && hasMore
      ? {
        eventId: events[events.length - 1]!.id,
        timestamp: events[events.length - 1]!.when.getTime(),
      }
      : undefined

    return {
      items: events,
      cursor,
      hasMore,
      total,
    }
  }

  queryBuilder(): EventQueryBuilder {
    return new InMemoryQueryBuilder(this)
  }

  async rebuildIndexes(): Promise<void> {
    // Collect all events first before clearing
    const allEvents = Array.from(this.events.values())

    // Clear primary storage and all indexes
    this.events.clear()
    this.byWhat.clear()
    this.byWhen = new BTreeIndex()
    this.byWhere.clear()
    this.byWhy.clear()
    this.byWho.clear()
    this.byHow.clear()
    this.byType.clear()
    this.byAction.clear()
    this.byWhatWhen.clear()
    this.byWhereWhen.clear()
    this.byWhyWhen.clear()

    // Re-index all events
    for (const event of allEvents) {
      await this.store(event)
    }

    this.lastIndexUpdate = new Date()
  }

  async getIndexStats(): Promise<IndexStats> {
    return {
      totalEvents: this.events.size,
      indexedDimensions: {
        what: this.byWhat.size,
        when: this.byWhen.size(),
        where: this.byWhere.size,
        why: this.byWhy.size,
        who: this.byWho.size,
        how: this.byHow.size,
        type: this.byType.size,
      },
      lastUpdated: this.lastIndexUpdate,
    }
  }

  getBackendType(): StorageBackendType {
    return 'memory'
  }

  // Helper methods
  private addToSetIndex<K>(index: Map<K, Set<string>>, key: K, eventId: string): void {
    let set = index.get(key)
    if (!set) {
      set = new Set()
      index.set(key, set)
    }
    set.add(eventId)
  }

  private removeFromSetIndex<K>(index: Map<K, Set<string>>, key: K, eventId: string): void {
    const set = index.get(key)
    if (set) {
      set.delete(eventId)
      if (set.size === 0) {
        index.delete(key)
      }
    }
  }

  private queryWhatWhen(what: string | string[], when: { gte?: Date; lte?: Date }): Set<string> {
    const result = new Set<string>()
    const whats = Array.isArray(what) ? what : [what]

    for (const objectId of whats) {
      // Check for wildcard
      if (this.isWildcardPattern(objectId)) {
        const prefix = this.getWildcardPrefix(objectId)
        for (const [key, index] of this.byWhatWhen) {
          if (key.startsWith(prefix)) {
            const ids = index.range(
              when.gte?.getTime(),
              when.lte?.getTime()
            )
            for (const id of ids) {
              result.add(id)
            }
          }
        }
      } else {
        const index = this.byWhatWhen.get(objectId)
        if (index) {
          const ids = index.range(
            when.gte?.getTime(),
            when.lte?.getTime()
          )
          for (const id of ids) {
            result.add(id)
          }
        }
      }
    }

    return result
  }

  private queryWhereWhen(where: string | string[], when: { gte?: Date; lte?: Date }): Set<string> {
    const result = new Set<string>()
    const wheres = Array.isArray(where) ? where : [where]

    for (const location of wheres) {
      const index = this.byWhereWhen.get(location)
      if (index) {
        const ids = index.range(
          when.gte?.getTime(),
          when.lte?.getTime()
        )
        for (const id of ids) {
          result.add(id)
        }
      }
    }

    return result
  }

  private queryWhyWhen(why: string | string[], when: { gte?: Date; lte?: Date }): Set<string> {
    const result = new Set<string>()
    const whys = Array.isArray(why) ? why : [why]

    for (const businessStep of whys) {
      const index = this.byWhyWhen.get(businessStep)
      if (index) {
        const ids = index.range(
          when.gte?.getTime(),
          when.lte?.getTime()
        )
        for (const id of ids) {
          result.add(id)
        }
      }
    }

    return result
  }

  private querySingleDimensions(query: EventQuery): Set<string> {
    let candidateIds: Set<string> | null = null

    // Filter by what
    if (query.what) {
      const whatIds = new Set<string>()
      const whats = Array.isArray(query.what) ? query.what : [query.what]

      for (const pattern of whats) {
        if (this.isWildcardPattern(pattern)) {
          const prefix = this.getWildcardPrefix(pattern)
          for (const [key, ids] of this.byWhat) {
            if (key.startsWith(prefix)) {
              for (const id of ids) {
                whatIds.add(id)
              }
            }
          }
        } else {
          const ids = this.byWhat.get(pattern)
          if (ids) {
            for (const id of ids) {
              whatIds.add(id)
            }
          }
        }
      }

      candidateIds = whatIds
    }

    // Filter by when (time range)
    if (query.when) {
      const whenIds = this.byWhen.range(
        query.when.gte?.getTime(),
        query.when.lte?.getTime()
      )
      const whenSet = new Set(whenIds)

      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => whenSet.has(id)))
        : whenSet
    }

    // Filter by where
    if (query.where) {
      const whereIds = new Set<string>()
      const wheres = Array.isArray(query.where) ? query.where : [query.where]

      for (const location of wheres) {
        const ids = this.byWhere.get(location)
        if (ids) {
          for (const id of ids) {
            whereIds.add(id)
          }
        }
      }

      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => whereIds.has(id)))
        : whereIds
    }

    // Filter by why
    if (query.why) {
      const whyIds = new Set<string>()
      const whys = Array.isArray(query.why) ? query.why : [query.why]

      for (const businessStep of whys) {
        const ids = this.byWhy.get(businessStep)
        if (ids) {
          for (const id of ids) {
            whyIds.add(id)
          }
        }
      }

      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => whyIds.has(id)))
        : whyIds
    }

    // Filter by who
    if (query.who) {
      const whoIds = new Set<string>()
      const whos = Array.isArray(query.who) ? query.who : [query.who]

      for (const party of whos) {
        const ids = this.byWho.get(party)
        if (ids) {
          for (const id of ids) {
            whoIds.add(id)
          }
        }
      }

      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => whoIds.has(id)))
        : whoIds
    }

    // Filter by how
    if (query.how) {
      const howIds = new Set<string>()
      const hows = Array.isArray(query.how) ? query.how : [query.how]

      for (const disposition of hows) {
        const ids = this.byHow.get(disposition)
        if (ids) {
          for (const id of ids) {
            howIds.add(id)
          }
        }
      }

      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => howIds.has(id)))
        : howIds
    }

    // Filter by type
    if (query.type) {
      const typeIds = new Set<string>()
      const types = Array.isArray(query.type) ? query.type : [query.type]

      for (const eventType of types) {
        const ids = this.byType.get(eventType)
        if (ids) {
          for (const id of ids) {
            typeIds.add(id)
          }
        }
      }

      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => typeIds.has(id)))
        : typeIds
    }

    // Filter by action
    if (query.action) {
      const actionIds = new Set<string>()
      const actions = Array.isArray(query.action) ? query.action : [query.action]

      for (const action of actions) {
        const ids = this.byAction.get(action)
        if (ids) {
          for (const id of ids) {
            actionIds.add(id)
          }
        }
      }

      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => actionIds.has(id)))
        : actionIds
    }

    // If no filters applied, return all event IDs
    if (candidateIds === null) {
      candidateIds = new Set(this.events.keys())
    }

    return candidateIds
  }

  private applyFilters(events: BusinessEvent[], query: EventQuery): BusinessEvent[] {
    let result = events

    // Filter by where (location) - needed when compound indexes don't cover this dimension
    if (query.where) {
      const wheres = Array.isArray(query.where) ? query.where : [query.where]
      result = result.filter((event) => event.where && wheres.includes(event.where))
    }

    // Filter by why (business step) - needed when compound indexes don't cover this dimension
    if (query.why) {
      const whys = Array.isArray(query.why) ? query.why : [query.why]
      result = result.filter((event) => event.why && whys.includes(event.why))
    }

    // Filter by who (party)
    if (query.who) {
      const whos = Array.isArray(query.who) ? query.who : [query.who]
      result = result.filter((event) => event.who && whos.includes(event.who))
    }

    // Filter by how (disposition)
    if (query.how) {
      const hows = Array.isArray(query.how) ? query.how : [query.how]
      result = result.filter((event) => event.how && hows.includes(event.how))
    }

    // Filter by type
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type]
      result = result.filter((event) => types.includes(event.type))
    }

    // Filter by action
    if (query.action) {
      const actions = Array.isArray(query.action) ? query.action : [query.action]
      result = result.filter((event) => event.action && actions.includes(event.action))
    }

    // Filter by extensions
    if (query.extensions) {
      result = result.filter((event) => {
        if (!event.extensions) return false
        for (const [key, value] of Object.entries(query.extensions!)) {
          if (event.extensions[key] !== value) {
            return false
          }
        }
        return true
      })
    }

    return result
  }

  /**
   * Check if a pattern matches with wildcard support (* or .*)
   */
  private isWildcardPattern(pattern: string): boolean {
    return pattern.endsWith('*')
  }

  /**
   * Get the prefix from a wildcard pattern
   */
  private getWildcardPrefix(pattern: string): string {
    if (pattern.endsWith('.*')) {
      return pattern.slice(0, -2)
    }
    if (pattern.endsWith('*')) {
      return pattern.slice(0, -1)
    }
    return pattern
  }
}

// =============================================================================
// Query Builder Implementation
// =============================================================================

/**
 * Fluent query builder for multi-dimensional event queries
 */
class InMemoryQueryBuilder implements EventQueryBuilder {
  private repository: InMemoryEventRepository
  private eventQuery: EventQuery = {}
  private queryOptions: CursorQueryOptions = {}

  constructor(repository: InMemoryEventRepository) {
    this.repository = repository
  }

  what(objectId: string | string[]): EventQueryBuilder {
    this.eventQuery.what = objectId
    return this
  }

  whatPrefix(prefix: string): EventQueryBuilder {
    this.eventQuery.what = `${prefix}.*`
    return this
  }

  when(range: { gte?: Date; lte?: Date }): EventQueryBuilder {
    this.eventQuery.when = range
    return this
  }

  where(location: string | string[]): EventQueryBuilder {
    this.eventQuery.where = location
    return this
  }

  why(businessStep: string | string[]): EventQueryBuilder {
    this.eventQuery.why = businessStep
    return this
  }

  who(party: string | string[]): EventQueryBuilder {
    this.eventQuery.who = party
    return this
  }

  how(disposition: string | string[]): EventQueryBuilder {
    this.eventQuery.how = disposition
    return this
  }

  type(eventType: EventType | EventType[]): EventQueryBuilder {
    this.eventQuery.type = eventType
    return this
  }

  action(action: EventAction | EventAction[]): EventQueryBuilder {
    this.eventQuery.action = action
    return this
  }

  limit(n: number): EventQueryBuilder {
    this.queryOptions.limit = n
    return this
  }

  cursor(cursor: EventCursor): EventQueryBuilder {
    this.queryOptions.cursor = cursor
    return this
  }

  orderBy(field: 'when' | 'recordTime', direction: 'asc' | 'desc' = 'desc'): EventQueryBuilder {
    this.queryOptions.orderBy = field
    this.queryOptions.orderDirection = direction
    return this
  }

  async execute(): Promise<PaginatedResult<BusinessEvent>> {
    return this.repository.query(this.eventQuery, this.queryOptions)
  }

  async count(): Promise<number> {
    const result = await this.repository.query(this.eventQuery, {
      ...this.queryOptions,
      includeTotal: true,
      limit: 0,
    })
    return result.total ?? 0
  }
}

// =============================================================================
// SQLite Event Repository Implementation
// =============================================================================

/**
 * SQLite-backed event repository with compound indexes
 */
class SQLiteEventRepository implements EventRepository {
  private db: SQLiteConnection
  private initialized: boolean = false

  constructor(db: SQLiteConnection) {
    this.db = db
  }

  private ensureInitialized(): void {
    if (this.initialized) return

    // Create events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS business_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        record_time INTEGER NOT NULL,
        event_time INTEGER NOT NULL,
        event_time_offset TEXT,
        what_json TEXT NOT NULL,
        where_location TEXT,
        biz_location TEXT,
        why TEXT,
        who TEXT,
        actor_type TEXT,
        confidence REAL,
        how TEXT,
        channel TEXT,
        session_id TEXT,
        device_id TEXT,
        context_json TEXT,
        action TEXT,
        caused_by TEXT,
        parent_event_id TEXT,
        correlation_id TEXT,
        extensions_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      -- Single dimension indexes
      CREATE INDEX IF NOT EXISTS idx_events_type ON business_events(type);
      CREATE INDEX IF NOT EXISTS idx_events_event_time ON business_events(event_time);
      CREATE INDEX IF NOT EXISTS idx_events_where ON business_events(where_location);
      CREATE INDEX IF NOT EXISTS idx_events_why ON business_events(why);
      CREATE INDEX IF NOT EXISTS idx_events_who ON business_events(who);
      CREATE INDEX IF NOT EXISTS idx_events_how ON business_events(how);
      CREATE INDEX IF NOT EXISTS idx_events_action ON business_events(action);
      CREATE INDEX IF NOT EXISTS idx_events_correlation ON business_events(correlation_id);

      -- Compound indexes for common query patterns
      CREATE INDEX IF NOT EXISTS idx_events_where_time ON business_events(where_location, event_time);
      CREATE INDEX IF NOT EXISTS idx_events_why_time ON business_events(why, event_time);
      CREATE INDEX IF NOT EXISTS idx_events_who_time ON business_events(who, event_time);
      CREATE INDEX IF NOT EXISTS idx_events_type_time ON business_events(type, event_time);

      -- What dimension (normalized for multi-value)
      CREATE TABLE IF NOT EXISTS event_what (
        event_id TEXT NOT NULL,
        object_id TEXT NOT NULL,
        event_time INTEGER NOT NULL,
        PRIMARY KEY (event_id, object_id),
        FOREIGN KEY (event_id) REFERENCES business_events(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_event_what_object ON event_what(object_id);
      CREATE INDEX IF NOT EXISTS idx_event_what_object_time ON event_what(object_id, event_time);
    `)

    this.initialized = true
  }

  async store(event: BusinessEvent): Promise<void> {
    this.ensureInitialized()

    this.db.transaction(() => {
      // Insert main event
      const stmt = this.db.prepare(`
        INSERT INTO business_events (
          id, type, record_time, event_time, event_time_offset,
          what_json, where_location, biz_location, why, who,
          actor_type, confidence, how, channel, session_id,
          device_id, context_json, action, caused_by,
          parent_event_id, correlation_id, extensions_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      stmt.run(
        event.id,
        event.type,
        event.recordTime.getTime(),
        event.when.getTime(),
        event.whenTimezoneOffset ?? null,
        JSON.stringify(event.what),
        event.where ?? null,
        event.bizLocation ?? null,
        event.why ?? null,
        event.who ?? null,
        event.actorType ?? null,
        event.confidence ?? null,
        event.how ?? null,
        event.channel ?? null,
        event.sessionId ?? null,
        event.deviceId ?? null,
        event.context ? JSON.stringify(event.context) : null,
        event.action ?? null,
        event.causedBy ?? null,
        event.parentEventId ?? null,
        event.correlationId ?? null,
        event.extensions ? JSON.stringify(event.extensions) : null
      )

      // Insert what dimension (normalized)
      const whatStmt = this.db.prepare(`
        INSERT INTO event_what (event_id, object_id, event_time)
        VALUES (?, ?, ?)
      `)

      for (const objectId of event.what) {
        whatStmt.run(event.id, objectId, event.when.getTime())
      }
    })
  }

  async storeBatch(events: BusinessEvent[]): Promise<void> {
    this.ensureInitialized()

    this.db.transaction(() => {
      for (const event of events) {
        // Use non-async version within transaction
        const stmt = this.db.prepare(`
          INSERT INTO business_events (
            id, type, record_time, event_time, event_time_offset,
            what_json, where_location, biz_location, why, who,
            actor_type, confidence, how, channel, session_id,
            device_id, context_json, action, caused_by,
            parent_event_id, correlation_id, extensions_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        stmt.run(
          event.id,
          event.type,
          event.recordTime.getTime(),
          event.when.getTime(),
          event.whenTimezoneOffset ?? null,
          JSON.stringify(event.what),
          event.where ?? null,
          event.bizLocation ?? null,
          event.why ?? null,
          event.who ?? null,
          event.actorType ?? null,
          event.confidence ?? null,
          event.how ?? null,
          event.channel ?? null,
          event.sessionId ?? null,
          event.deviceId ?? null,
          event.context ? JSON.stringify(event.context) : null,
          event.action ?? null,
          event.causedBy ?? null,
          event.parentEventId ?? null,
          event.correlationId ?? null,
          event.extensions ? JSON.stringify(event.extensions) : null
        )

        const whatStmt = this.db.prepare(`
          INSERT INTO event_what (event_id, object_id, event_time)
          VALUES (?, ?, ?)
        `)

        for (const objectId of event.what) {
          whatStmt.run(event.id, objectId, event.when.getTime())
        }
      }
    })
  }

  async get(id: string): Promise<BusinessEvent | null> {
    this.ensureInitialized()

    const stmt = this.db.prepare(`
      SELECT * FROM business_events WHERE id = ?
    `)

    const row = stmt.get(id) as Record<string, unknown> | undefined
    if (!row) return null

    return this.rowToEvent(row)
  }

  async delete(id: string): Promise<boolean> {
    this.ensureInitialized()

    const stmt = this.db.prepare(`DELETE FROM business_events WHERE id = ?`)
    stmt.run(id)

    // event_what entries are deleted via CASCADE
    return true
  }

  async query(query: EventQuery, options?: CursorQueryOptions): Promise<PaginatedResult<BusinessEvent>> {
    this.ensureInitialized()

    const { sql, params } = this.buildQuerySQL(query, options)
    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as Record<string, unknown>[]

    const events = rows.map((row) => this.rowToEvent(row))

    // Build pagination result
    const limit = options?.limit ?? 100
    const hasMore = events.length > limit
    const items = events.slice(0, limit)

    const cursor = items.length > 0 && hasMore
      ? {
        eventId: items[items.length - 1]!.id,
        timestamp: items[items.length - 1]!.when.getTime(),
      }
      : undefined

    let total: number | undefined
    if (options?.includeTotal) {
      const countSQL = this.buildCountSQL(query)
      const countStmt = this.db.prepare(countSQL.sql)
      const countResult = countStmt.get(...countSQL.params) as { count: number }
      total = countResult.count
    }

    return {
      items,
      cursor,
      hasMore,
      total,
    }
  }

  queryBuilder(): EventQueryBuilder {
    return new SQLiteQueryBuilder(this)
  }

  async rebuildIndexes(): Promise<void> {
    this.ensureInitialized()

    this.db.exec(`
      REINDEX business_events;
      REINDEX event_what;
    `)
  }

  async getIndexStats(): Promise<IndexStats> {
    this.ensureInitialized()

    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM business_events`)
    const result = countStmt.get() as { count: number }

    const whatCountStmt = this.db.prepare(`SELECT COUNT(DISTINCT object_id) as count FROM event_what`)
    const whatResult = whatCountStmt.get() as { count: number }

    const whereCountStmt = this.db.prepare(`SELECT COUNT(DISTINCT where_location) as count FROM business_events WHERE where_location IS NOT NULL`)
    const whereResult = whereCountStmt.get() as { count: number }

    const whyCountStmt = this.db.prepare(`SELECT COUNT(DISTINCT why) as count FROM business_events WHERE why IS NOT NULL`)
    const whyResult = whyCountStmt.get() as { count: number }

    const whoCountStmt = this.db.prepare(`SELECT COUNT(DISTINCT who) as count FROM business_events WHERE who IS NOT NULL`)
    const whoResult = whoCountStmt.get() as { count: number }

    const howCountStmt = this.db.prepare(`SELECT COUNT(DISTINCT how) as count FROM business_events WHERE how IS NOT NULL`)
    const howResult = howCountStmt.get() as { count: number }

    const typeCountStmt = this.db.prepare(`SELECT COUNT(DISTINCT type) as count FROM business_events`)
    const typeResult = typeCountStmt.get() as { count: number }

    return {
      totalEvents: result.count,
      indexedDimensions: {
        what: whatResult.count,
        when: result.count, // Every event has a timestamp
        where: whereResult.count,
        why: whyResult.count,
        who: whoResult.count,
        how: howResult.count,
        type: typeResult.count,
      },
      lastUpdated: new Date(),
    }
  }

  getBackendType(): StorageBackendType {
    return 'sqlite'
  }

  private rowToEvent(row: Record<string, unknown>): BusinessEvent {
    return {
      id: row.id as string,
      type: row.type as BusinessEvent['type'],
      recordTime: new Date(row.record_time as number),
      what: JSON.parse(row.what_json as string) as string[],
      when: new Date(row.event_time as number),
      whenTimezoneOffset: row.event_time_offset as string | undefined,
      where: row.where_location as string | undefined,
      bizLocation: row.biz_location as string | undefined,
      why: row.why as string | undefined,
      who: row.who as string | undefined,
      actorType: row.actor_type as BusinessEvent['actorType'],
      confidence: row.confidence as number | undefined,
      how: row.how as string | undefined,
      channel: row.channel as BusinessEvent['channel'],
      sessionId: row.session_id as string | undefined,
      deviceId: row.device_id as string | undefined,
      context: row.context_json ? JSON.parse(row.context_json as string) : undefined,
      action: row.action as BusinessEvent['action'],
      causedBy: row.caused_by as string | undefined,
      parentEventId: row.parent_event_id as string | undefined,
      correlationId: row.correlation_id as string | undefined,
      extensions: row.extensions_json ? JSON.parse(row.extensions_json as string) : undefined,
    }
  }

  private buildQuerySQL(query: EventQuery, options?: CursorQueryOptions): { sql: string; params: unknown[] } {
    const conditions: string[] = []
    const params: unknown[] = []
    let needsWhatJoin = false

    // What filter
    if (query.what) {
      needsWhatJoin = true
      const whats = Array.isArray(query.what) ? query.what : [query.what]
      const whatConditions: string[] = []

      for (const pattern of whats) {
        if (pattern.endsWith('.*')) {
          whatConditions.push('w.object_id LIKE ?')
          params.push(pattern.slice(0, -1) + '%')
        } else {
          whatConditions.push('w.object_id = ?')
          params.push(pattern)
        }
      }

      conditions.push(`(${whatConditions.join(' OR ')})`)
    }

    // When filter
    if (query.when) {
      if (query.when.gte) {
        conditions.push('e.event_time >= ?')
        params.push(query.when.gte.getTime())
      }
      if (query.when.lte) {
        conditions.push('e.event_time <= ?')
        params.push(query.when.lte.getTime())
      }
    }

    // Where filter
    if (query.where) {
      const wheres = Array.isArray(query.where) ? query.where : [query.where]
      conditions.push(`e.where_location IN (${wheres.map(() => '?').join(', ')})`)
      params.push(...wheres)
    }

    // Why filter
    if (query.why) {
      const whys = Array.isArray(query.why) ? query.why : [query.why]
      conditions.push(`e.why IN (${whys.map(() => '?').join(', ')})`)
      params.push(...whys)
    }

    // Who filter
    if (query.who) {
      const whos = Array.isArray(query.who) ? query.who : [query.who]
      conditions.push(`e.who IN (${whos.map(() => '?').join(', ')})`)
      params.push(...whos)
    }

    // How filter
    if (query.how) {
      const hows = Array.isArray(query.how) ? query.how : [query.how]
      conditions.push(`e.how IN (${hows.map(() => '?').join(', ')})`)
      params.push(...hows)
    }

    // Type filter
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type]
      conditions.push(`e.type IN (${types.map(() => '?').join(', ')})`)
      params.push(...types)
    }

    // Action filter
    if (query.action) {
      const actions = Array.isArray(query.action) ? query.action : [query.action]
      conditions.push(`e.action IN (${actions.map(() => '?').join(', ')})`)
      params.push(...actions)
    }

    // Cursor filter
    if (options?.cursor) {
      const direction = options.orderDirection ?? 'desc'
      const operator = direction === 'desc' ? '<' : '>'
      conditions.push(`(e.event_time ${operator} ? OR (e.event_time = ? AND e.id ${operator} ?))`)
      params.push(options.cursor.timestamp, options.cursor.timestamp, options.cursor.eventId)
    }

    // Build SQL
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const orderDirection = options?.orderDirection ?? 'desc'
    const orderBy = options?.orderBy ?? 'when'
    const orderColumn = orderBy === 'when' ? 'e.event_time' : 'e.record_time'
    const limit = (options?.limit ?? 100) + 1 // Fetch one extra to detect hasMore

    let sql: string
    if (needsWhatJoin) {
      sql = `
        SELECT DISTINCT e.*
        FROM business_events e
        JOIN event_what w ON e.id = w.event_id
        ${whereClause}
        ORDER BY ${orderColumn} ${orderDirection.toUpperCase()}, e.id ${orderDirection.toUpperCase()}
        LIMIT ?
      `
    } else {
      sql = `
        SELECT e.*
        FROM business_events e
        ${whereClause}
        ORDER BY ${orderColumn} ${orderDirection.toUpperCase()}, e.id ${orderDirection.toUpperCase()}
        LIMIT ?
      `
    }

    params.push(limit)

    return { sql, params }
  }

  private buildCountSQL(query: EventQuery): { sql: string; params: unknown[] } {
    const conditions: string[] = []
    const params: unknown[] = []
    let needsWhatJoin = false

    // What filter
    if (query.what) {
      needsWhatJoin = true
      const whats = Array.isArray(query.what) ? query.what : [query.what]
      const whatConditions: string[] = []

      for (const pattern of whats) {
        if (pattern.endsWith('.*')) {
          whatConditions.push('w.object_id LIKE ?')
          params.push(pattern.slice(0, -1) + '%')
        } else {
          whatConditions.push('w.object_id = ?')
          params.push(pattern)
        }
      }

      conditions.push(`(${whatConditions.join(' OR ')})`)
    }

    // Other filters (same as buildQuerySQL)
    if (query.when) {
      if (query.when.gte) {
        conditions.push('e.event_time >= ?')
        params.push(query.when.gte.getTime())
      }
      if (query.when.lte) {
        conditions.push('e.event_time <= ?')
        params.push(query.when.lte.getTime())
      }
    }

    if (query.where) {
      const wheres = Array.isArray(query.where) ? query.where : [query.where]
      conditions.push(`e.where_location IN (${wheres.map(() => '?').join(', ')})`)
      params.push(...wheres)
    }

    if (query.why) {
      const whys = Array.isArray(query.why) ? query.why : [query.why]
      conditions.push(`e.why IN (${whys.map(() => '?').join(', ')})`)
      params.push(...whys)
    }

    if (query.who) {
      const whos = Array.isArray(query.who) ? query.who : [query.who]
      conditions.push(`e.who IN (${whos.map(() => '?').join(', ')})`)
      params.push(...whos)
    }

    if (query.how) {
      const hows = Array.isArray(query.how) ? query.how : [query.how]
      conditions.push(`e.how IN (${hows.map(() => '?').join(', ')})`)
      params.push(...hows)
    }

    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type]
      conditions.push(`e.type IN (${types.map(() => '?').join(', ')})`)
      params.push(...types)
    }

    if (query.action) {
      const actions = Array.isArray(query.action) ? query.action : [query.action]
      conditions.push(`e.action IN (${actions.map(() => '?').join(', ')})`)
      params.push(...actions)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    let sql: string
    if (needsWhatJoin) {
      sql = `
        SELECT COUNT(DISTINCT e.id) as count
        FROM business_events e
        JOIN event_what w ON e.id = w.event_id
        ${whereClause}
      `
    } else {
      sql = `
        SELECT COUNT(*) as count
        FROM business_events e
        ${whereClause}
      `
    }

    return { sql, params }
  }
}

/**
 * SQLite query builder
 */
class SQLiteQueryBuilder implements EventQueryBuilder {
  private repository: SQLiteEventRepository
  private eventQuery: EventQuery = {}
  private queryOptions: CursorQueryOptions = {}

  constructor(repository: SQLiteEventRepository) {
    this.repository = repository
  }

  what(objectId: string | string[]): EventQueryBuilder {
    this.eventQuery.what = objectId
    return this
  }

  whatPrefix(prefix: string): EventQueryBuilder {
    this.eventQuery.what = `${prefix}.*`
    return this
  }

  when(range: { gte?: Date; lte?: Date }): EventQueryBuilder {
    this.eventQuery.when = range
    return this
  }

  where(location: string | string[]): EventQueryBuilder {
    this.eventQuery.where = location
    return this
  }

  why(businessStep: string | string[]): EventQueryBuilder {
    this.eventQuery.why = businessStep
    return this
  }

  who(party: string | string[]): EventQueryBuilder {
    this.eventQuery.who = party
    return this
  }

  how(disposition: string | string[]): EventQueryBuilder {
    this.eventQuery.how = disposition
    return this
  }

  type(eventType: EventType | EventType[]): EventQueryBuilder {
    this.eventQuery.type = eventType
    return this
  }

  action(action: EventAction | EventAction[]): EventQueryBuilder {
    this.eventQuery.action = action
    return this
  }

  limit(n: number): EventQueryBuilder {
    this.queryOptions.limit = n
    return this
  }

  cursor(cursor: EventCursor): EventQueryBuilder {
    this.queryOptions.cursor = cursor
    return this
  }

  orderBy(field: 'when' | 'recordTime', direction: 'asc' | 'desc' = 'desc'): EventQueryBuilder {
    this.queryOptions.orderBy = field
    this.queryOptions.orderDirection = direction
    return this
  }

  async execute(): Promise<PaginatedResult<BusinessEvent>> {
    return this.repository.query(this.eventQuery, this.queryOptions)
  }

  async count(): Promise<number> {
    const result = await this.repository.query(this.eventQuery, {
      ...this.queryOptions,
      includeTotal: true,
      limit: 0,
    })
    return result.total ?? 0
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an EventRepository with the specified storage backend
 */
export function createEventRepository(config?: StorageBackendConfig): EventRepository {
  if (!config || config.type === 'memory') {
    return new InMemoryEventRepository()
  }

  if (config.type === 'sqlite' && config.sqlite) {
    return new SQLiteEventRepository(config.sqlite)
  }

  // Default to in-memory
  return new InMemoryEventRepository()
}

/**
 * Create an in-memory EventRepository
 */
export function createInMemoryEventRepository(): EventRepository {
  return new InMemoryEventRepository()
}

/**
 * Create a SQLite-backed EventRepository
 */
export function createSQLiteEventRepository(db: SQLiteConnection): EventRepository {
  return new SQLiteEventRepository(db)
}
