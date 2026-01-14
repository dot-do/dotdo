/**
 * @dotdo/cubejs - Query Builder and Query Types
 *
 * Provides a fluent API for building Cube.js-compatible queries.
 *
 * @example
 * ```typescript
 * import { QueryBuilder } from '@dotdo/cubejs'
 *
 * const query = new QueryBuilder()
 *   .select('Orders.count', 'Orders.totalAmount')
 *   .dimensions('Orders.status')
 *   .where('Orders.status', 'equals', 'completed')
 *   .timeDimension('Orders.createdAt', 'day', ['2024-01-01', '2024-12-31'])
 *   .orderBy('Orders.totalAmount', 'desc')
 *   .limit(100)
 *   .build()
 * ```
 */

import type { Granularity } from './schema'

// =============================================================================
// Filter Types
// =============================================================================

/**
 * Supported filter operators
 */
export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'set'
  | 'notSet'
  | 'inDateRange'
  | 'notInDateRange'
  | 'beforeDate'
  | 'afterDate'
  | 'measureFilter'

/**
 * Filter definition
 */
export interface Filter {
  /**
   * Member to filter (Cube.member)
   */
  member: string

  /**
   * Filter operator
   */
  operator: FilterOperator

  /**
   * Filter values
   */
  values?: (string | number | boolean)[]
}

/**
 * Logical filter for combining filters
 */
export interface LogicalFilter {
  /**
   * Logical operator
   */
  and?: (Filter | LogicalFilter)[]
  or?: (Filter | LogicalFilter)[]
}

// =============================================================================
// Time Dimension Types
// =============================================================================

/**
 * Time dimension definition
 */
export interface TimeDimension {
  /**
   * Time dimension member (Cube.dimension)
   */
  dimension: string

  /**
   * Granularity for grouping
   */
  granularity?: Granularity | null

  /**
   * Date range (array of two dates or relative string)
   */
  dateRange?: string | [string, string]

  /**
   * Compare to another date range
   */
  compareDateRange?: string | [string, string]
}

// =============================================================================
// Order Types
// =============================================================================

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Order configuration
 */
export type Order = {
  [member: string]: SortDirection
}

// =============================================================================
// Pivot Types
// =============================================================================

/**
 * Pivot configuration for result formatting
 */
export interface PivotConfig {
  /**
   * Members to use as x-axis
   */
  x?: string[]

  /**
   * Members to use as y-axis
   */
  y?: string[]

  /**
   * Fill missing dates with null
   */
  fillMissingDates?: boolean

  /**
   * Join date range results
   */
  joinDateRange?: boolean
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Complete query definition
 */
export interface CubeQuery {
  /**
   * Measures to query
   */
  measures?: string[]

  /**
   * Dimensions to query
   */
  dimensions?: string[]

  /**
   * Segments to apply
   */
  segments?: string[]

  /**
   * Filters to apply
   */
  filters?: (Filter | LogicalFilter)[]

  /**
   * Time dimensions with granularity
   */
  timeDimensions?: TimeDimension[]

  /**
   * Result ordering
   */
  order?: Order

  /**
   * Maximum number of rows
   */
  limit?: number

  /**
   * Number of rows to skip
   */
  offset?: number

  /**
   * Timezone for time dimensions
   */
  timezone?: string

  /**
   * Force query refresh
   */
  renewQuery?: boolean

  /**
   * Return ungrouped results
   */
  ungrouped?: boolean

  /**
   * Include total row count
   */
  total?: boolean

  /**
   * Pivot configuration
   */
  pivotConfig?: PivotConfig

  /**
   * Response format
   */
  responseFormat?: 'default' | 'compact'
}

// =============================================================================
// Query Builder
// =============================================================================

/**
 * Fluent builder for constructing Cube.js queries
 */
export class QueryBuilder {
  private _measures: string[] = []
  private _dimensions: string[] = []
  private _segments: string[] = []
  private _filters: (Filter | LogicalFilter)[] = []
  private _timeDimensions: TimeDimension[] = []
  private _order?: Order
  private _limit?: number
  private _offset?: number
  private _timezone?: string
  private _renewQuery?: boolean
  private _ungrouped?: boolean
  private _total?: boolean
  private _pivotConfig?: PivotConfig
  private _responseFormat?: 'default' | 'compact'
  private _currentTimeDimensionIndex?: number

  /**
   * Add measures to the query
   */
  select(...measures: string[]): this {
    this._measures.push(...measures)
    return this
  }

  /**
   * Alias for select
   */
  measures(...measures: string[]): this {
    return this.select(...measures)
  }

  /**
   * Add dimensions to the query
   */
  dimensions(...dimensions: string[]): this {
    this._dimensions.push(...dimensions)
    return this
  }

  /**
   * Add segments to the query
   */
  segments(...segments: string[]): this {
    this._segments.push(...segments)
    return this
  }

  /**
   * Add a filter to the query
   */
  where(
    member: string,
    operator: FilterOperator,
    values?: (string | number | boolean) | (string | number | boolean)[]
  ): this {
    const filter: Filter = {
      member,
      operator,
    }

    if (values !== undefined) {
      filter.values = Array.isArray(values) ? values : [values]
    }

    this._filters.push(filter)
    return this
  }

  /**
   * Add an AND logical filter group
   */
  andWhere(...filters: (Filter | LogicalFilter)[]): this {
    this._filters.push({ and: filters })
    return this
  }

  /**
   * Add an OR logical filter group
   */
  orWhere(...filters: (Filter | LogicalFilter)[]): this {
    this._filters.push({ or: filters })
    return this
  }

  /**
   * Add a time dimension to the query
   */
  timeDimension(
    dimension: string,
    granularity?: Granularity | null,
    dateRange?: string | [string, string]
  ): this {
    const timeDim: TimeDimension = {
      dimension,
    }

    if (granularity !== undefined) {
      timeDim.granularity = granularity
    }

    if (dateRange !== undefined) {
      timeDim.dateRange = dateRange
    }

    this._timeDimensions.push(timeDim)
    this._currentTimeDimensionIndex = this._timeDimensions.length - 1
    return this
  }

  /**
   * Add a compare date range to the last time dimension
   */
  compareDateRange(dateRange: string | [string, string]): this {
    if (this._currentTimeDimensionIndex === undefined) {
      throw new Error('compareDateRange must be called after timeDimension')
    }

    this._timeDimensions[this._currentTimeDimensionIndex].compareDateRange = dateRange
    return this
  }

  /**
   * Add ordering to the query
   */
  orderBy(member: string, direction: SortDirection = 'asc'): this {
    if (!this._order) {
      this._order = {}
    }
    this._order[member] = direction
    return this
  }

  /**
   * Set the limit
   */
  limit(n: number): this {
    this._limit = n
    return this
  }

  /**
   * Set the offset
   */
  offset(n: number): this {
    this._offset = n
    return this
  }

  /**
   * Set the timezone
   */
  timezone(tz: string): this {
    this._timezone = tz
    return this
  }

  /**
   * Force query refresh
   */
  renewQuery(): this {
    this._renewQuery = true
    return this
  }

  /**
   * Return ungrouped results
   */
  ungrouped(): this {
    this._ungrouped = true
    return this
  }

  /**
   * Include total row count
   */
  withTotal(): this {
    this._total = true
    return this
  }

  /**
   * Configure pivot
   */
  pivot(config: PivotConfig): this {
    this._pivotConfig = config
    return this
  }

  /**
   * Set response format
   */
  format(format: 'default' | 'compact'): this {
    this._responseFormat = format
    return this
  }

  /**
   * Build the query object
   */
  build(): CubeQuery {
    const query: CubeQuery = {}

    if (this._measures.length > 0) {
      query.measures = this._measures
    }

    if (this._dimensions.length > 0) {
      query.dimensions = this._dimensions
    }

    if (this._segments.length > 0) {
      query.segments = this._segments
    }

    if (this._filters.length > 0) {
      query.filters = this._filters
    }

    if (this._timeDimensions.length > 0) {
      query.timeDimensions = this._timeDimensions
    }

    if (this._order) {
      query.order = this._order
    }

    if (this._limit !== undefined) {
      query.limit = this._limit
    }

    if (this._offset !== undefined) {
      query.offset = this._offset
    }

    if (this._timezone) {
      query.timezone = this._timezone
    }

    if (this._renewQuery) {
      query.renewQuery = this._renewQuery
    }

    if (this._ungrouped) {
      query.ungrouped = this._ungrouped
    }

    if (this._total) {
      query.total = this._total
    }

    if (this._pivotConfig) {
      query.pivotConfig = this._pivotConfig
    }

    if (this._responseFormat) {
      query.responseFormat = this._responseFormat
    }

    return query
  }

  /**
   * Create a new QueryBuilder from an existing query
   */
  static from(query: CubeQuery): QueryBuilder {
    const builder = new QueryBuilder()

    if (query.measures) {
      builder._measures = [...query.measures]
    }

    if (query.dimensions) {
      builder._dimensions = [...query.dimensions]
    }

    if (query.segments) {
      builder._segments = [...query.segments]
    }

    if (query.filters) {
      builder._filters = [...query.filters]
    }

    if (query.timeDimensions) {
      builder._timeDimensions = [...query.timeDimensions]
    }

    if (query.order) {
      builder._order = { ...query.order }
    }

    if (query.limit !== undefined) {
      builder._limit = query.limit
    }

    if (query.offset !== undefined) {
      builder._offset = query.offset
    }

    if (query.timezone) {
      builder._timezone = query.timezone
    }

    if (query.renewQuery) {
      builder._renewQuery = query.renewQuery
    }

    if (query.ungrouped) {
      builder._ungrouped = query.ungrouped
    }

    if (query.total) {
      builder._total = query.total
    }

    if (query.pivotConfig) {
      builder._pivotConfig = { ...query.pivotConfig }
    }

    if (query.responseFormat) {
      builder._responseFormat = query.responseFormat
    }

    return builder
  }
}

// =============================================================================
// Query Helpers
// =============================================================================

/**
 * Create a filter object
 */
export function filter(
  member: string,
  operator: FilterOperator,
  values?: (string | number | boolean)[]
): Filter {
  return { member, operator, values }
}

/**
 * Create an AND logical filter
 */
export function and(...filters: (Filter | LogicalFilter)[]): LogicalFilter {
  return { and: filters }
}

/**
 * Create an OR logical filter
 */
export function or(...filters: (Filter | LogicalFilter)[]): LogicalFilter {
  return { or: filters }
}

/**
 * Create a time dimension object
 */
export function timeDimension(
  dimension: string,
  granularity?: Granularity | null,
  dateRange?: string | [string, string]
): TimeDimension {
  const td: TimeDimension = { dimension }
  if (granularity !== undefined) td.granularity = granularity
  if (dateRange !== undefined) td.dateRange = dateRange
  return td
}

/**
 * Normalize a query to ensure consistent structure
 */
export function normalizeQuery(query: CubeQuery): CubeQuery {
  return {
    measures: query.measures || [],
    dimensions: query.dimensions || [],
    segments: query.segments || [],
    filters: query.filters || [],
    timeDimensions: query.timeDimensions || [],
    order: query.order,
    limit: query.limit,
    offset: query.offset,
    timezone: query.timezone || 'UTC',
    renewQuery: query.renewQuery,
    ungrouped: query.ungrouped,
    total: query.total,
    pivotConfig: query.pivotConfig,
    responseFormat: query.responseFormat,
  }
}

/**
 * Get all referenced cubes from a query
 */
export function getQueryCubes(query: CubeQuery): Set<string> {
  const cubes = new Set<string>()

  const addCube = (member: string) => {
    const parts = member.split('.')
    if (parts.length >= 1) {
      cubes.add(parts[0])
    }
  }

  query.measures?.forEach(addCube)
  query.dimensions?.forEach(addCube)
  query.segments?.forEach(addCube)
  query.timeDimensions?.forEach((td) => addCube(td.dimension))

  const extractFilters = (filters: (Filter | LogicalFilter)[] | undefined) => {
    filters?.forEach((f) => {
      if ('member' in f) {
        addCube(f.member)
      }
      if ('and' in f && f.and) {
        extractFilters(f.and)
      }
      if ('or' in f && f.or) {
        extractFilters(f.or)
      }
    })
  }

  extractFilters(query.filters)

  return cubes
}

/**
 * Validate that all members in a query exist
 */
export function validateQueryMembers(
  query: CubeQuery,
  validMeasures: Set<string>,
  validDimensions: Set<string>,
  validSegments: Set<string>
): string[] {
  const errors: string[] = []

  query.measures?.forEach((m) => {
    if (!validMeasures.has(m)) {
      errors.push(`Unknown measure: ${m}`)
    }
  })

  query.dimensions?.forEach((d) => {
    if (!validDimensions.has(d)) {
      errors.push(`Unknown dimension: ${d}`)
    }
  })

  query.segments?.forEach((s) => {
    if (!validSegments.has(s)) {
      errors.push(`Unknown segment: ${s}`)
    }
  })

  query.timeDimensions?.forEach((td) => {
    if (!validDimensions.has(td.dimension)) {
      errors.push(`Unknown time dimension: ${td.dimension}`)
    }
  })

  const validateFilters = (filters: (Filter | LogicalFilter)[] | undefined) => {
    filters?.forEach((f) => {
      if ('member' in f) {
        if (!validMeasures.has(f.member) && !validDimensions.has(f.member)) {
          errors.push(`Unknown filter member: ${f.member}`)
        }
      }
      if ('and' in f && f.and) {
        validateFilters(f.and)
      }
      if ('or' in f && f.or) {
        validateFilters(f.or)
      }
    })
  }

  validateFilters(query.filters)

  return errors
}
