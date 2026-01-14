/**
 * AuditLogQuery - Query Engine for Audit Log Entries
 *
 * Provides powerful querying capabilities for audit logs:
 * - **Filter by actor**: userId, serviceId, system, displayName, ipAddress
 * - **Filter by action**: type, namespace, custom actions
 * - **Filter by resource**: type, id, path (with prefix matching)
 * - **Time range queries**: before, after, between with relative time support
 * - **Pagination**: Offset/limit and cursor-based pagination
 * - **Sorting**: Multiple fields, ascending/descending
 * - **Projections**: Include/exclude specific fields
 * - **Compound queries**: AND, OR, NOT, NOR operators
 *
 * RED Phase Stub - All implementations throw until GREEN phase.
 *
 * @see dotdo-xxsw0 - [RED] Query/filter tests
 * @see dotdo-9xw2u - [PRIMITIVE] AuditLog - Immutable compliance and audit trail
 */

import type {
  AuditEntry,
  Actor,
  Action,
  Resource,
  AuditTimestamp,
  AuditMetadata,
  EventCorrelation,
} from './tests/audit-entry'

// =============================================================================
// FILTER TYPES
// =============================================================================

/**
 * Comparison operators for query filters
 */
export interface ComparisonOperators<T> {
  /** Equals */
  $eq?: T
  /** Not equals */
  $ne?: T
  /** Greater than */
  $gt?: T
  /** Greater than or equal */
  $gte?: T
  /** Less than */
  $lt?: T
  /** Less than or equal */
  $lte?: T
  /** In array */
  $in?: T[]
  /** Not in array */
  $nin?: T[]
  /** Regular expression match */
  $regex?: string
  /** String contains */
  $contains?: string
  /** String starts with */
  $startsWith?: string
  /** String ends with */
  $endsWith?: string
  /** Not equal to */
  $not?: T
  /** Field exists */
  $exists?: boolean
}

/**
 * Relative time specification
 */
export interface RelativeTime {
  $relative: string // e.g., '-2h', '-7d', '-1w'
}

/**
 * Timestamp filter with multiple input formats
 */
export type TimestampFilter = number | string | Date | RelativeTime | {
  $gte?: number | string | Date | RelativeTime
  $gt?: number | string | Date | RelativeTime
  $lte?: number | string | Date | RelativeTime
  $lt?: number | string | Date | RelativeTime
}

/**
 * Actor filter options
 */
export interface ActorFilter {
  userId?: string | ComparisonOperators<string>
  serviceId?: string | ComparisonOperators<string>
  system?: boolean
  displayName?: string | ComparisonOperators<string>
  ipAddress?: string | ComparisonOperators<string>
  $or?: ActorFilter[]
}

/**
 * Action filter options
 */
export interface ActionFilter {
  type?: string | ComparisonOperators<string>
  namespace?: string | ComparisonOperators<string>
  isCustom?: boolean
}

/**
 * Resource filter options
 */
export interface ResourceFilter {
  type?: string | ComparisonOperators<string>
  id?: string | ComparisonOperators<string>
  path?: string | ComparisonOperators<string>
}

/**
 * Correlation filter options
 */
export interface CorrelationFilter {
  correlationId?: string | ComparisonOperators<string>
  causationId?: string | ComparisonOperators<string>
  parentId?: string | ComparisonOperators<string>
  transactionId?: string | ComparisonOperators<string>
}

/**
 * Metadata filter options
 */
export interface MetadataFilter {
  ipAddress?: string | ComparisonOperators<string>
  userAgent?: string | ComparisonOperators<string>
  requestId?: string | ComparisonOperators<string>
  sessionId?: string | ComparisonOperators<string>
  [key: string]: unknown
}

/**
 * State filter options
 */
export interface StateFilter {
  $exists?: boolean
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

/**
 * Complete query filter specification
 */
export interface AuditQueryFilter {
  /** Filter by actor */
  actor?: ActorFilter
  /** Filter by action */
  action?: ActionFilter
  /** Filter by resource */
  resource?: ResourceFilter
  /** Filter by timestamp */
  timestamp?: TimestampFilter
  /** Filter by correlation */
  correlation?: CorrelationFilter
  /** Filter by metadata */
  metadata?: MetadataFilter
  /** Filter by state */
  state?: StateFilter
  /** Filter by schema version */
  schemaVersion?: number | ComparisonOperators<number>
  /** Logical AND of multiple filters */
  $and?: AuditQueryFilter[]
  /** Logical OR of multiple filters */
  $or?: AuditQueryFilter[]
  /** Logical NOR of multiple filters */
  $nor?: AuditQueryFilter[]
}

// =============================================================================
// SORT TYPES
// =============================================================================

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Sort specification for query results
 */
export interface AuditQuerySort {
  [field: string]: SortDirection
}

// =============================================================================
// PROJECTION TYPES
// =============================================================================

/**
 * Field projection specification
 */
export interface AuditQueryProjection {
  /** Fields to include (whitelist) */
  include?: string[]
  /** Fields to exclude (blacklist) */
  exclude?: string[]
}

// =============================================================================
// PAGINATION TYPES
// =============================================================================

/**
 * Cursor information for pagination
 */
export interface CursorInfo {
  /** Cursor for next page */
  next?: string
  /** Cursor for previous page */
  previous?: string
  /** Whether there are more results */
  hasMore: boolean
}

/**
 * Offset-based pagination options
 */
export interface OffsetPaginationOptions {
  /** Number of results to skip */
  offset?: number
  /** Maximum number of results to return */
  limit?: number
  /** Whether to include total count (may be slower) */
  includeTotalCount?: boolean
}

/**
 * Cursor-based pagination options
 */
export interface CursorPaginationOptions {
  /** Maximum number of results to return */
  limit?: number
  /** Use cursor-based pagination */
  useCursor?: true
  /** Cursor from previous result */
  cursor?: string
}

// =============================================================================
// QUERY OPTIONS
// =============================================================================

/**
 * Query options for creating AuditLogQuery instance
 */
export interface AuditQueryOptions {
  /** Enable indexes for better performance */
  enableIndexes?: boolean
  /** Default page size */
  defaultPageSize?: number
  /** Maximum page size */
  maxPageSize?: number
  /** Custom storage backend */
  storage?: AuditQueryStorage
}

/**
 * Find options combining sort, projection, and pagination
 */
export type FindOptions = {
  /** Sort specification */
  sort?: AuditQuerySort
  /** Field projection */
  projection?: AuditQueryProjection
} & (OffsetPaginationOptions | CursorPaginationOptions)

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Query result with entries and pagination info
 */
export interface AuditQueryResult {
  /** Matching entries */
  entries: AuditEntry[]
  /** Total count of matching entries (if requested) */
  totalCount?: number
  /** Cursor information for pagination */
  cursor?: CursorInfo
}

// =============================================================================
// STORAGE INTERFACE
// =============================================================================

/**
 * Storage interface for query operations
 */
export interface AuditQueryStorage {
  /** Insert an entry */
  insert(entry: AuditEntry): Promise<void>
  /** Find entries matching filter */
  find(filter: AuditQueryFilter, options?: FindOptions): Promise<AuditQueryResult>
  /** Count entries matching filter */
  count(filter: AuditQueryFilter): Promise<number>
  /** Clear all entries */
  clear(): Promise<void>
}

// =============================================================================
// MAIN QUERY CLASS - IMPLEMENTATION
// =============================================================================

/**
 * AuditLogQuery - Query engine for audit log entries
 *
 * Provides comprehensive querying capabilities for audit logs including
 * filtering, sorting, pagination, and projections.
 */
export class AuditLogQuery {
  private readonly options: AuditQueryOptions
  private readonly storage: AuditQueryStorage

  constructor(options?: AuditQueryOptions) {
    this.options = options ?? {}
    this.storage = options?.storage ?? createInMemoryStorage()
  }

  /**
   * Insert an entry into the query index
   */
  async insert(entry: AuditEntry): Promise<void> {
    await this.storage.insert(entry)
  }

  /**
   * Find entries matching the given filter
   *
   * @param filter - Query filter specification
   * @param options - Pagination, sort, and projection options
   * @returns Query result with matching entries
   */
  async find(filter: AuditQueryFilter, options?: FindOptions): Promise<AuditQueryResult> {
    return await this.storage.find(filter, options)
  }

  /**
   * Count entries matching the given filter
   *
   * @param filter - Query filter specification
   * @returns Number of matching entries
   */
  async count(filter: AuditQueryFilter): Promise<number> {
    return await this.storage.count(filter)
  }

  /**
   * Clear all entries from the query index
   */
  async clear(): Promise<void> {
    await this.storage.clear()
  }
}

// =============================================================================
// IN-MEMORY STORAGE - IMPLEMENTATION
// =============================================================================

/**
 * Parse relative time string to epoch milliseconds
 */
function parseRelativeTime(relative: string): number {
  const now = Date.now()
  const match = relative.match(/^(-?\d+)([smhdwMy])$/)
  if (!match) {
    throw new Error(`Invalid relative time format: ${relative}`)
  }
  const amount = parseInt(match[1], 10)
  const unit = match[2]
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  }
  return now + amount * multipliers[unit]
}

/**
 * Convert timestamp filter value to epoch milliseconds
 */
function toEpochMs(value: number | string | Date | RelativeTime): number {
  if (typeof value === 'number') {
    return value
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === 'object' && '$relative' in value) {
    return parseRelativeTime(value.$relative)
  }
  return new Date(value).getTime()
}

/**
 * Check if a value matches a comparison operator
 */
function matchComparison<T>(value: T | undefined, filter: T | ComparisonOperators<T>): boolean {
  if (value === undefined) {
    // Check for $exists operator
    if (typeof filter === 'object' && filter !== null && '$exists' in (filter as ComparisonOperators<T>)) {
      return !(filter as ComparisonOperators<T>).$exists
    }
    return false
  }

  // Simple equality check
  if (typeof filter !== 'object' || filter === null || filter instanceof Date) {
    return value === filter
  }

  const ops = filter as ComparisonOperators<T>

  // Check $exists first
  if ('$exists' in ops) {
    const exists = value !== undefined && value !== null
    if (!ops.$exists && exists) return false
    if (ops.$exists && !exists) return false
  }

  if ('$eq' in ops && value !== ops.$eq) return false
  if ('$ne' in ops && value === ops.$ne) return false
  if ('$not' in ops && value === ops.$not) return false

  // Numeric/comparable comparisons
  if ('$gt' in ops && !(value as unknown as number > (ops.$gt as unknown as number))) return false
  if ('$gte' in ops && !(value as unknown as number >= (ops.$gte as unknown as number))) return false
  if ('$lt' in ops && !(value as unknown as number < (ops.$lt as unknown as number))) return false
  if ('$lte' in ops && !(value as unknown as number <= (ops.$lte as unknown as number))) return false

  // Array membership
  if ('$in' in ops && ops.$in && !ops.$in.includes(value)) return false
  if ('$nin' in ops && ops.$nin && ops.$nin.includes(value)) return false

  // String operations
  if (typeof value === 'string') {
    if ('$regex' in ops && ops.$regex && !new RegExp(ops.$regex).test(value)) return false
    if ('$contains' in ops && ops.$contains && !value.includes(ops.$contains)) return false
    if ('$startsWith' in ops && ops.$startsWith && !value.startsWith(ops.$startsWith)) return false
    if ('$endsWith' in ops && ops.$endsWith && !value.endsWith(ops.$endsWith)) return false
  }

  return true
}

/**
 * Check if an entry matches actor filter
 */
function matchActorFilter(actor: Actor | undefined, filter: ActorFilter): boolean {
  if (!actor) return false

  // Handle $or at actor level
  if (filter.$or) {
    return filter.$or.some(subFilter => matchActorFilter(actor, subFilter))
  }

  if (filter.userId !== undefined && !matchComparison(actor.userId, filter.userId)) return false
  if (filter.serviceId !== undefined && !matchComparison(actor.serviceId, filter.serviceId)) return false
  if (filter.system !== undefined && actor.system !== filter.system) return false
  if (filter.displayName !== undefined && !matchComparison(actor.displayName, filter.displayName)) return false
  if (filter.ipAddress !== undefined && !matchComparison(actor.ipAddress, filter.ipAddress)) return false

  return true
}

/**
 * Check if an entry matches action filter
 */
function matchActionFilter(action: Action | undefined, filter: ActionFilter): boolean {
  if (!action) return false

  if (filter.type !== undefined && !matchComparison(action.type, filter.type)) return false
  if (filter.namespace !== undefined && !matchComparison(action.namespace, filter.namespace)) return false
  if (filter.isCustom !== undefined && action.isCustom !== filter.isCustom) return false

  return true
}

/**
 * Check if an entry matches resource filter
 */
function matchResourceFilter(resource: Resource | undefined, filter: ResourceFilter): boolean {
  if (!resource) return false

  if (filter.type !== undefined && !matchComparison(resource.type, filter.type)) return false
  if (filter.id !== undefined && !matchComparison(resource.id, filter.id)) return false
  if (filter.path !== undefined && !matchComparison(resource.path, filter.path)) return false

  return true
}

/**
 * Check if an entry matches timestamp filter
 */
function matchTimestampFilter(timestamp: AuditTimestamp | undefined, filter: TimestampFilter): boolean {
  if (!timestamp) return false

  const entryMs = timestamp.epochMs

  // Simple value comparison (exact match)
  if (typeof filter === 'number' || typeof filter === 'string' || filter instanceof Date) {
    return entryMs === toEpochMs(filter)
  }

  // Relative time
  if ('$relative' in filter) {
    return entryMs >= toEpochMs(filter)
  }

  // Range comparisons
  const rangeFilter = filter as { $gte?: unknown; $gt?: unknown; $lte?: unknown; $lt?: unknown }
  if ('$gte' in rangeFilter && rangeFilter.$gte !== undefined && entryMs < toEpochMs(rangeFilter.$gte as number)) return false
  if ('$gt' in rangeFilter && rangeFilter.$gt !== undefined && entryMs <= toEpochMs(rangeFilter.$gt as number)) return false
  if ('$lte' in rangeFilter && rangeFilter.$lte !== undefined && entryMs > toEpochMs(rangeFilter.$lte as number)) return false
  if ('$lt' in rangeFilter && rangeFilter.$lt !== undefined && entryMs >= toEpochMs(rangeFilter.$lt as number)) return false

  return true
}

/**
 * Check if an entry matches correlation filter
 */
function matchCorrelationFilter(correlation: EventCorrelation | undefined, filter: CorrelationFilter): boolean {
  if (!correlation) {
    // Check if filter requires correlation to not exist
    return Object.keys(filter).length === 0
  }

  if (filter.correlationId !== undefined && !matchComparison(correlation.correlationId, filter.correlationId)) return false
  if (filter.causationId !== undefined && !matchComparison(correlation.causationId, filter.causationId)) return false
  if (filter.parentId !== undefined && !matchComparison(correlation.parentId, filter.parentId)) return false
  if (filter.transactionId !== undefined && !matchComparison(correlation.transactionId, filter.transactionId)) return false

  return true
}

/**
 * Check if an entry matches metadata filter
 */
function matchMetadataFilter(metadata: AuditMetadata | undefined, filter: MetadataFilter): boolean {
  if (!metadata) return Object.keys(filter).length === 0

  for (const [key, filterValue] of Object.entries(filter)) {
    const metadataValue = (metadata as Record<string, unknown>)[key]
    if (!matchComparison(metadataValue, filterValue as string | ComparisonOperators<unknown>)) {
      return false
    }
  }

  return true
}

/**
 * Check if an entry matches state filter
 */
function matchStateFilter(state: { before?: Record<string, unknown>; after?: Record<string, unknown> } | undefined, filter: StateFilter): boolean {
  if (filter.$exists !== undefined) {
    const exists = state !== undefined && (state.before !== undefined || state.after !== undefined)
    return filter.$exists === exists
  }
  return true
}

/**
 * Check if an entry matches the complete filter
 */
function matchFilter(entry: AuditEntry, filter: AuditQueryFilter): boolean {
  // Handle logical operators
  if (filter.$and) {
    if (!filter.$and.every(subFilter => matchFilter(entry, subFilter))) return false
  }

  if (filter.$or) {
    if (!filter.$or.some(subFilter => matchFilter(entry, subFilter))) return false
  }

  if (filter.$nor) {
    if (filter.$nor.some(subFilter => matchFilter(entry, subFilter))) return false
  }

  // Match individual filters
  if (filter.actor && !matchActorFilter(entry.actor, filter.actor)) return false
  if (filter.action && !matchActionFilter(entry.action, filter.action)) return false
  if (filter.resource && !matchResourceFilter(entry.resource, filter.resource)) return false
  if (filter.timestamp && !matchTimestampFilter(entry.timestamp, filter.timestamp)) return false
  if (filter.correlation && !matchCorrelationFilter(entry.correlation, filter.correlation)) return false
  if (filter.metadata && !matchMetadataFilter(entry.metadata, filter.metadata)) return false
  if (filter.state && !matchStateFilter(entry.state, filter.state)) return false
  if (filter.schemaVersion !== undefined && !matchComparison(entry.schemaVersion, filter.schemaVersion)) return false

  return true
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
 * Get sortable value from entry, handling special cases like timestamp
 */
function getSortValue(entry: AuditEntry, field: string): unknown {
  // Handle timestamp field specially - use epochMs for comparison
  if (field === 'timestamp') {
    return entry.timestamp?.epochMs
  }
  return getNestedValue(entry as unknown as Record<string, unknown>, field)
}

/**
 * Sort entries by sort specification
 */
function sortEntries(entries: AuditEntry[], sort: AuditQuerySort): AuditEntry[] {
  const sortKeys = Object.entries(sort)
  if (sortKeys.length === 0) {
    // Default: reverse chronological order
    return [...entries].sort((a, b) => b.timestamp.epochMs - a.timestamp.epochMs)
  }

  return [...entries].sort((a, b) => {
    for (const [field, direction] of sortKeys) {
      const aVal = getSortValue(a, field)
      const bVal = getSortValue(b, field)

      let cmp = 0
      if (aVal === bVal) {
        cmp = 0
      } else if (aVal === undefined || aVal === null) {
        cmp = 1
      } else if (bVal === undefined || bVal === null) {
        cmp = -1
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal
      } else if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal)
      } else if (aVal instanceof Date && bVal instanceof Date) {
        cmp = aVal.getTime() - bVal.getTime()
      }

      if (cmp !== 0) {
        return direction === 'desc' ? -cmp : cmp
      }
    }
    return 0
  })
}

/**
 * Set nested value in object using dot notation
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

/**
 * Apply projection to entries
 */
function applyProjection(entries: AuditEntry[], projection: AuditQueryProjection): AuditEntry[] {
  if (!projection.include && !projection.exclude) {
    return entries
  }

  return entries.map(entry => {
    const result: Record<string, unknown> = { id: entry.id } // Always include id

    if (projection.include) {
      for (const field of projection.include) {
        if (field === 'id') continue // Already included
        const value = getNestedValue(entry as unknown as Record<string, unknown>, field)
        if (value !== undefined) {
          // Handle nested paths by building the object structure
          setNestedValue(result, field, value)
        }
      }
    } else if (projection.exclude) {
      const entryObj = entry as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(entryObj)) {
        if (!projection.exclude.includes(key)) {
          result[key] = value
        }
      }
    }

    return result as unknown as AuditEntry
  })
}

/**
 * Encode cursor from index
 */
function encodeCursor(index: number): string {
  return Buffer.from(JSON.stringify({ i: index })).toString('base64')
}

/**
 * Decode cursor to index
 */
function decodeCursor(cursor: string): number {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'))
    if (typeof decoded.i !== 'number') {
      throw new Error('Invalid cursor format')
    }
    return decoded.i
  } catch {
    throw new Error('Invalid cursor')
  }
}

/**
 * Create an in-memory storage backend
 */
function createInMemoryStorage(): AuditQueryStorage {
  let entries: AuditEntry[] = []

  return {
    async insert(entry: AuditEntry): Promise<void> {
      entries.push(entry)
    },

    async find(filter: AuditQueryFilter, options?: FindOptions): Promise<AuditQueryResult> {
      // Filter entries
      let matched = entries.filter(entry => matchFilter(entry, filter))

      // Sort
      if (options?.sort) {
        matched = sortEntries(matched, options.sort)
      } else {
        // Default: reverse chronological
        matched = sortEntries(matched, { 'timestamp.epochMs': 'desc' })
      }

      // Calculate total before pagination
      const totalCount = matched.length

      // Handle cursor-based pagination (either useCursor flag or cursor provided)
      const hasCursor = options && ('cursor' in options || ('useCursor' in options && options.useCursor))
      if (hasCursor) {
        const cursorOptions = options as CursorPaginationOptions
        const limit = cursorOptions.limit ?? 10
        let startIndex = 0

        if (cursorOptions.cursor) {
          startIndex = decodeCursor(cursorOptions.cursor)
        }

        const pageEntries = matched.slice(startIndex, startIndex + limit)
        const hasMore = startIndex + limit < matched.length

        // Apply projection
        const projectedEntries = options.projection
          ? applyProjection(pageEntries, options.projection)
          : pageEntries

        return {
          entries: projectedEntries,
          cursor: {
            hasMore,
            next: hasMore ? encodeCursor(startIndex + limit) : undefined,
            previous: startIndex > 0 ? encodeCursor(Math.max(0, startIndex - limit)) : undefined,
          },
        }
      }

      // Handle offset-based pagination
      const offsetOptions = options as OffsetPaginationOptions | undefined
      const offset = offsetOptions?.offset ?? 0
      const limit = offsetOptions?.limit ?? matched.length

      const pageEntries = matched.slice(offset, offset + limit)

      // Apply projection
      const projectedEntries = options?.projection
        ? applyProjection(pageEntries, options.projection)
        : pageEntries

      const result: AuditQueryResult = {
        entries: projectedEntries,
      }

      if (offsetOptions?.includeTotalCount) {
        result.totalCount = totalCount
      }

      return result
    },

    async count(filter: AuditQueryFilter): Promise<number> {
      return entries.filter(entry => matchFilter(entry, filter)).length
    },

    async clear(): Promise<void> {
      entries = []
    },
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new AuditLogQuery instance
 *
 * @param options - Configuration options
 * @returns A new AuditLogQuery instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const query = createAuditLogQuery()
 *
 * // Query by actor
 * const result = await query.find({
 *   actor: { userId: 'user-123' },
 * })
 *
 * // Query with time range
 * const recentActivity = await query.find({
 *   actor: { userId: 'user-123' },
 *   timestamp: {
 *     $gte: Date.now() - 24 * 60 * 60 * 1000, // Last 24 hours
 *   },
 * })
 *
 * // Compound query with pagination
 * const page1 = await query.find(
 *   {
 *     $or: [
 *       { action: { type: 'create' } },
 *       { action: { type: 'delete' } },
 *     ],
 *   },
 *   { limit: 10, useCursor: true }
 * )
 * ```
 */
export function createAuditLogQuery(options?: AuditQueryOptions): AuditLogQuery {
  return new AuditLogQuery(options)
}
