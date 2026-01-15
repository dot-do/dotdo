/**
 * Query Layer - Fluent, type-safe query builder for unified storage
 *
 * Provides a builder pattern API for constructing and executing queries
 * with support for filtering, pagination, sorting, and aggregation.
 *
 * @module objects/unified-storage/query-layer
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Filter operators supported by the query layer
 */
export type FilterOperator =
  | 'eq'      // Equals
  | 'ne'      // Not equals
  | 'gt'      // Greater than
  | 'lt'      // Less than
  | 'gte'     // Greater than or equal
  | 'lte'     // Less than or equal
  | 'in'      // In array
  | 'nin'     // Not in array
  | 'contains'    // String contains
  | 'startsWith'  // String starts with
  | 'endsWith'    // String ends with
  | 'exists'      // Field exists

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc'

/**
 * A single filter condition
 */
export interface FilterCondition {
  field: string
  operator: FilterOperator
  value: unknown
}

/**
 * Sort specification
 */
export interface SortSpec {
  field: string
  direction: SortDirection
}

/**
 * Cursor information for pagination
 */
export interface CursorInfo {
  field: string
  direction: SortDirection
  value: unknown
}

/**
 * Index hint for query optimization
 */
export interface IndexHint {
  field: string
  type: 'exact' | 'range' | 'prefix' | 'fulltext'
}

/**
 * Estimated query cost
 */
export interface QueryCost {
  scanRows: number
  returnRows: number
}

/**
 * Query execution plan
 */
export interface QueryPlan {
  filters: FilterCondition[]
  sorts: SortSpec[]
  limit?: number
  offset?: number
  scanType: 'index' | 'full'
  indexHints: IndexHint[]
  estimatedCost: QueryCost
}

/**
 * Query result with pagination metadata
 */
export interface QueryResult<T> {
  data: T[]
  total: number
  hasMore: boolean
  cursor?: string
  cursorInfo?: CursorInfo
}

/**
 * Query options passed to store
 */
export interface QueryOptions<T> {
  filters: FilterCondition[]
  compoundFilters?: CompoundFilter[]
  sorts: SortSpec[]
  limit?: number
  offset?: number
  afterCursor?: string
  beforeCursor?: string
  select?: (keyof T)[]
  transform?: (item: T) => unknown
}

/**
 * Compound filter (AND/OR)
 */
export interface CompoundFilter {
  type: 'and' | 'or'
  conditions: FilterCondition[]
  nested?: CompoundFilter[]
}

/**
 * Store interface expected by Query
 */
export interface QueryStore<T = unknown> {
  things: Map<string, T>
  query(options: QueryOptions<T>): Promise<QueryResult<T>>
}

/**
 * Stream options for batch iteration
 */
export interface StreamOptions {
  batchSize: number
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a value from an object using dot notation path
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current === 'object') {
      // Handle array index access
      const index = parseInt(part, 10)
      if (!isNaN(index) && Array.isArray(current)) {
        current = current[index]
      } else {
        current = (current as Record<string, unknown>)[part]
      }
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Apply a single filter condition to an item
 */
function applyFilter(item: unknown, filter: FilterCondition): boolean {
  const value = getNestedValue(item, filter.field)

  switch (filter.operator) {
    case 'eq':
      return value === filter.value

    case 'ne':
      return value !== filter.value

    case 'gt':
      return typeof value === 'number' && typeof filter.value === 'number'
        ? value > filter.value
        : typeof value === 'string' && typeof filter.value === 'string'
        ? value > filter.value
        : false

    case 'lt':
      return typeof value === 'number' && typeof filter.value === 'number'
        ? value < filter.value
        : typeof value === 'string' && typeof filter.value === 'string'
        ? value < filter.value
        : false

    case 'gte':
      return typeof value === 'number' && typeof filter.value === 'number'
        ? value >= filter.value
        : typeof value === 'string' && typeof filter.value === 'string'
        ? value >= filter.value
        : false

    case 'lte':
      return typeof value === 'number' && typeof filter.value === 'number'
        ? value <= filter.value
        : typeof value === 'string' && typeof filter.value === 'string'
        ? value <= filter.value
        : false

    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(value)

    case 'nin':
      return Array.isArray(filter.value) && !filter.value.includes(value)

    case 'contains':
      return typeof value === 'string' && typeof filter.value === 'string'
        ? value.includes(filter.value)
        : false

    case 'startsWith':
      return typeof value === 'string' && typeof filter.value === 'string'
        ? value.startsWith(filter.value)
        : false

    case 'endsWith':
      return typeof value === 'string' && typeof filter.value === 'string'
        ? value.endsWith(filter.value)
        : false

    case 'exists':
      const exists = value !== undefined
      return filter.value === true ? exists : !exists

    default:
      return false
  }
}

/**
 * Apply compound filter to an item
 */
function applyCompoundFilter(item: unknown, compound: CompoundFilter): boolean {
  // Evaluate direct conditions
  const conditionResults = compound.conditions.map(c => applyFilter(item, c))

  // Evaluate nested compounds recursively
  const nestedResults = (compound.nested || []).map(n =>
    applyCompoundFilter(item, n)
  )

  const allResults = [...conditionResults, ...nestedResults]

  if (compound.type === 'and') {
    return allResults.length === 0 || allResults.every(r => r)
  } else {
    return allResults.some(r => r)
  }
}

/**
 * Compare two values for sorting
 */
function compareValues(a: unknown, b: unknown, direction: SortDirection): number {
  let result = 0

  if (a === b) {
    result = 0
  } else if (a === null || a === undefined) {
    result = 1
  } else if (b === null || b === undefined) {
    result = -1
  } else if (typeof a === 'number' && typeof b === 'number') {
    result = a - b
  } else if (typeof a === 'string' && typeof b === 'string') {
    result = a.localeCompare(b)
  } else {
    result = String(a).localeCompare(String(b))
  }

  return direction === 'desc' ? -result : result
}

/**
 * Cursor data structure containing both boundaries
 */
interface CursorData {
  first: unknown  // First item's sort value (for before pagination)
  last: unknown   // Last item's sort value (for after pagination)
}

/**
 * Encode cursor from first and last values
 */
function encodeCursor(first: unknown, last: unknown): string {
  const data: CursorData = { first, last }
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

/**
 * Decode cursor to CursorData
 */
function decodeCursor(cursor: string): CursorData {
  return JSON.parse(Buffer.from(cursor, 'base64').toString())
}

// ============================================================================
// QUERY CLASS
// ============================================================================

/**
 * Fluent query builder for unified storage
 */
export class Query<T, R = T> {
  private readonly store: QueryStore<T>
  private readonly options: QueryOptions<T>
  private readonly transformFn?: (item: T) => R

  constructor(
    store: QueryStore<T>,
    options: QueryOptions<T> = { filters: [], sorts: [] },
    transformFn?: (item: T) => R
  ) {
    this.store = store
    this.options = { ...options }
    this.transformFn = transformFn
  }

  /**
   * Clone the query with new options
   */
  private clone<NewR = R>(
    overrides: Partial<QueryOptions<T>> = {},
    newTransform?: (item: T) => NewR
  ): Query<T, NewR> {
    return new Query<T, NewR>(
      this.store,
      {
        ...this.options,
        filters: [...this.options.filters],
        compoundFilters: this.options.compoundFilters
          ? [...this.options.compoundFilters]
          : undefined,
        sorts: [...this.options.sorts],
        ...overrides,
      },
      newTransform as ((item: T) => NewR) | undefined
    )
  }

  /**
   * Add a where clause filter
   */
  where(field: string, operator: FilterOperator, value: unknown): Query<T, R> {
    const newFilters = [...this.options.filters, { field, operator, value }]
    return this.clone({ filters: newFilters })
  }

  /**
   * Combine conditions with AND
   */
  and(...builders: ((q: Query<T, R>) => Query<T, R>)[]): Query<T, R> {
    const conditions: FilterCondition[] = []
    const nested: CompoundFilter[] = []

    for (const builder of builders) {
      const subQuery = builder(new Query<T, R>(this.store))
      conditions.push(...subQuery.options.filters)
      if (subQuery.options.compoundFilters) {
        nested.push(...subQuery.options.compoundFilters)
      }
    }

    const compound: CompoundFilter = {
      type: 'and',
      conditions,
      nested: nested.length > 0 ? nested : undefined,
    }

    const existingCompounds = this.options.compoundFilters || []
    return this.clone({
      compoundFilters: [...existingCompounds, compound],
    })
  }

  /**
   * Combine conditions with OR
   */
  or(...builders: ((q: Query<T, R>) => Query<T, R>)[]): Query<T, R> {
    const conditions: FilterCondition[] = []
    const nested: CompoundFilter[] = []

    for (const builder of builders) {
      const subQuery = builder(new Query<T, R>(this.store))
      conditions.push(...subQuery.options.filters)
      if (subQuery.options.compoundFilters) {
        nested.push(...subQuery.options.compoundFilters)
      }
    }

    const compound: CompoundFilter = {
      type: 'or',
      conditions,
      nested: nested.length > 0 ? nested : undefined,
    }

    const existingCompounds = this.options.compoundFilters || []
    return this.clone({
      compoundFilters: [...existingCompounds, compound],
    })
  }

  /**
   * Sort by field
   */
  sort(field: string, direction: SortDirection = 'asc'): Query<T, R> {
    return this.clone({ sorts: [{ field, direction }] })
  }

  /**
   * Add secondary sort
   */
  thenSort(field: string, direction: SortDirection = 'asc'): Query<T, R> {
    const newSorts = [...this.options.sorts, { field, direction }]
    return this.clone({ sorts: newSorts })
  }

  /**
   * Limit results
   */
  limit(n: number): Query<T, R> {
    return this.clone({ limit: n })
  }

  /**
   * Offset results
   */
  offset(n: number): Query<T, R> {
    // Treat negative offset as 0
    return this.clone({ offset: Math.max(0, n) })
  }

  /**
   * Cursor-based pagination - after cursor
   */
  after(cursor: string): Query<T, R> {
    return this.clone({ afterCursor: cursor })
  }

  /**
   * Cursor-based pagination - before cursor
   */
  before(cursor: string): Query<T, R> {
    return this.clone({ beforeCursor: cursor })
  }

  /**
   * Select specific fields
   */
  select<K extends keyof T>(...fields: K[]): Query<T, Pick<T, K>> {
    return this.clone<Pick<T, K>>({ select: fields as (keyof T)[] })
  }

  /**
   * Transform results
   */
  map<NewR>(fn: (item: T) => NewR): Query<T, NewR> {
    return this.clone<NewR>({}, fn)
  }

  /**
   * Count matching records
   */
  async count(): Promise<number> {
    const result = await this.executeQuery()
    return result.total
  }

  /**
   * Generate query execution plan
   */
  explain(): QueryPlan {
    const indexHints: IndexHint[] = []
    let scanType: 'index' | 'full' = 'index'

    for (const filter of this.options.filters) {
      switch (filter.operator) {
        case 'eq':
          indexHints.push({ field: filter.field, type: 'exact' })
          break
        case 'gt':
        case 'lt':
        case 'gte':
        case 'lte':
          indexHints.push({ field: filter.field, type: 'range' })
          break
        case 'startsWith':
          indexHints.push({ field: filter.field, type: 'prefix' })
          break
        case 'contains':
        case 'endsWith':
          // These require full scan
          scanType = 'full'
          indexHints.push({ field: filter.field, type: 'fulltext' })
          break
        case 'in':
        case 'nin':
          indexHints.push({ field: filter.field, type: 'exact' })
          break
        case 'exists':
          indexHints.push({ field: filter.field, type: 'exact' })
          break
      }
    }

    // Estimate cost based on query characteristics
    const estimatedScanRows = scanType === 'full' ? 10000 : 100
    const estimatedReturnRows = this.options.limit || estimatedScanRows

    return {
      filters: this.options.filters,
      sorts: this.options.sorts,
      limit: this.options.limit,
      offset: this.options.offset,
      scanType,
      indexHints,
      estimatedCost: {
        scanRows: estimatedScanRows,
        returnRows: estimatedReturnRows,
      },
    }
  }

  /**
   * Execute the query
   */
  async exec(): Promise<QueryResult<R>> {
    return this.executeQuery()
  }

  /**
   * Stream results in batches
   */
  async *stream(options: StreamOptions): AsyncGenerator<R[], void, unknown> {
    const { batchSize } = options
    let currentOffset = 0
    let hasMore = true

    while (hasMore) {
      const result = await this.clone({
        offset: currentOffset,
        limit: batchSize,
      }).executeQuery()

      if (result.data.length > 0) {
        yield result.data as R[]
      }

      hasMore = result.hasMore
      currentOffset += batchSize
    }
  }

  /**
   * Internal query execution
   */
  private async executeQuery(): Promise<QueryResult<R>> {
    // Notify store that query is being executed (for observability/testing)
    // The store can optionally implement query() for custom behavior
    if (typeof this.store.query === 'function') {
      // Call store.query with our options - allows store to override execution
      // or track query patterns. We still execute locally for in-memory stores.
      await this.store.query(this.options)
    }

    // Get all items from store
    let items = Array.from(this.store.things.values())

    // Apply top-level filters (AND by default)
    for (const filter of this.options.filters) {
      items = items.filter(item => applyFilter(item, filter))
    }

    // Apply compound filters
    if (this.options.compoundFilters) {
      for (const compound of this.options.compoundFilters) {
        items = items.filter(item => applyCompoundFilter(item, compound))
      }
    }

    // Get total count before pagination
    const total = items.length

    // Apply sorting
    if (this.options.sorts.length > 0) {
      items.sort((a, b) => {
        for (const sort of this.options.sorts) {
          const aValue = getNestedValue(a, sort.field)
          const bValue = getNestedValue(b, sort.field)
          const cmp = compareValues(aValue, bValue, sort.direction)
          if (cmp !== 0) return cmp
        }
        return 0
      })
    }

    // Handle cursor-based pagination
    if (this.options.afterCursor && this.options.sorts.length > 0) {
      const cursorData = decodeCursor(this.options.afterCursor)
      // Use 'last' value for 'after' pagination (items after the last item of previous page)
      const cursorValue = cursorData.last
      const sortField = this.options.sorts[0].field
      const sortDir = this.options.sorts[0].direction

      const idx = items.findIndex(item => {
        const itemValue = getNestedValue(item, sortField)
        if (sortDir === 'asc') {
          return String(itemValue) > String(cursorValue)
        } else {
          return String(itemValue) < String(cursorValue)
        }
      })

      if (idx >= 0) {
        items = items.slice(idx)
      } else {
        items = []
      }
    }

    if (this.options.beforeCursor && this.options.sorts.length > 0) {
      const cursorData = decodeCursor(this.options.beforeCursor)
      // Use 'first' value for 'before' pagination (items before the first item of current page)
      const cursorValue = cursorData.first
      const sortField = this.options.sorts[0].field
      const sortDir = this.options.sorts[0].direction

      // Find all items before the cursor
      const idx = items.findIndex(item => {
        const itemValue = getNestedValue(item, sortField)
        if (sortDir === 'asc') {
          return String(itemValue) >= String(cursorValue)
        } else {
          return String(itemValue) <= String(cursorValue)
        }
      })

      if (idx >= 0) {
        items = items.slice(0, idx)
      }

      // For before pagination, we want the last N items
      if (this.options.limit) {
        const start = Math.max(0, items.length - this.options.limit)
        items = items.slice(start)
      }
    }

    // Apply offset
    const offset = this.options.offset || 0
    if (offset > 0) {
      items = items.slice(offset)
    }

    // Apply limit and check hasMore
    let hasMore = false
    if (this.options.limit !== undefined) {
      if (items.length > this.options.limit) {
        hasMore = true
        items = items.slice(0, this.options.limit)
      } else {
        // Check if there are more items beyond current page
        hasMore = offset + items.length < total
      }
    }

    // Apply select (field projection)
    let resultData: unknown[] = items
    if (this.options.select && this.options.select.length > 0) {
      resultData = items.map(item => {
        const projected: Partial<T> = {}
        for (const field of this.options.select!) {
          projected[field] = (item as T)[field]
        }
        return projected
      })
    }

    // Apply transformation
    if (this.transformFn) {
      resultData = items.map(item => this.transformFn!(item))
    }

    // Generate cursor info for pagination
    let cursor: string | undefined
    let cursorInfo: CursorInfo | undefined

    if (items.length > 0 && this.options.sorts.length > 0) {
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const sortField = this.options.sorts[0].field
      const sortDir = this.options.sorts[0].direction
      const firstValue = getNestedValue(firstItem, sortField)
      const lastValue = getNestedValue(lastItem, sortField)

      cursor = encodeCursor(firstValue, lastValue)
      cursorInfo = {
        field: sortField,
        direction: sortDir,
        value: firstValue,  // Use first value for cursorInfo as it represents page start
      }
    }

    return {
      data: resultData as R[],
      total,
      hasMore,
      cursor,
      cursorInfo,
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new Query instance for the given store
 */
export function createQuery<T>(store: QueryStore<T>): Query<T, T> {
  return new Query<T, T>(store)
}
