/**
 * SemanticLayer - Metrics, dimensions, and cubes for business intelligence
 *
 * Provides a consistent abstraction layer for analytics and BI by defining
 * business metrics (measures) and dimensions that can be queried consistently
 * across different tools and interfaces.
 *
 * @example
 * ```typescript
 * import { SemanticLayer } from './semantic-layer'
 *
 * const semantic = new SemanticLayer()
 *
 * semantic.defineCube({
 *   name: 'orders',
 *   sql: 'SELECT * FROM orders',
 *   measures: {
 *     count: { type: 'count' },
 *     totalRevenue: { type: 'sum', sql: 'amount' },
 *   },
 *   dimensions: {
 *     status: { type: 'string', sql: 'status' },
 *     createdAt: { type: 'time', sql: 'created_at' },
 *   },
 * })
 *
 * const result = await semantic.query({
 *   measures: ['orders.totalRevenue'],
 *   dimensions: ['orders.status'],
 *   filters: [
 *     { dimension: 'orders.createdAt', operator: 'gte', values: ['2024-01-01'] },
 *   ],
 * })
 * ```
 *
 * @see dotdo-oi5zh
 */

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Base error for semantic layer operations
 */
export class SemanticLayerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SemanticLayerError'
  }
}

/**
 * Error thrown when a cube is not found
 */
export class CubeNotFoundError extends SemanticLayerError {
  public readonly cubeName: string

  constructor(cubeName: string) {
    super(`Cube '${cubeName}' not found`)
    this.name = 'CubeNotFoundError'
    this.cubeName = cubeName
  }
}

/**
 * Error thrown for invalid query structure or references
 */
export class InvalidQueryError extends SemanticLayerError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidQueryError'
  }
}

/**
 * Error thrown for cache-related issues
 */
export class CacheError extends SemanticLayerError {
  constructor(message: string) {
    super(message)
    this.name = 'CacheError'
  }
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Supported metric aggregation types
 */
export type MetricType =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'countDistinct'
  | 'custom'

/**
 * Supported dimension types
 */
export type DimensionType = 'string' | 'number' | 'time' | 'boolean' | 'geo'

/**
 * Time granularity options
 */
export type Granularity =
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'

/**
 * Filter operators
 */
export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'between'
  | 'isNull'
  | 'isNotNull'

/**
 * Join relationship types
 */
export type JoinRelationship =
  | 'belongsTo'
  | 'hasMany'
  | 'hasOne'
  | 'manyToMany'

/**
 * SQL dialect options
 */
export type SQLDialect = 'postgres' | 'clickhouse' | 'duckdb' | 'sqlite' | 'mysql'

/**
 * Metric definition
 */
export interface MetricDefinition {
  type: MetricType
  sql?: string
  description?: string
  format?: string
  meta?: Record<string, unknown>
}

/**
 * Dimension definition
 */
export interface DimensionDefinition {
  type: DimensionType
  sql: string
  description?: string
  primaryKey?: boolean
  meta?: Record<string, unknown>
}

/**
 * Join definition
 */
export interface JoinDefinition {
  name: string
  relationship: JoinRelationship
  sql: string
}

/**
 * Cube definition
 */
export interface CubeDefinition {
  name: string
  sql: string
  measures: Record<string, MetricDefinition>
  dimensions: Record<string, DimensionDefinition>
  joins?: JoinDefinition[]
  segments?: Record<string, { sql: string }>
  preAggregations?: PreAggregationDefinition[]
}

/**
 * Pre-aggregation definition
 */
export interface PreAggregationDefinition {
  name: string
  measures: string[]
  dimensions: string[]
  timeDimension?: string
  granularity?: Granularity
  refreshKey?: {
    every?: string
    sql?: string
  }
  partitionGranularity?: Granularity
  indexes?: Record<string, { columns: string[] }>
}

/**
 * Filter in a semantic query
 */
export interface QueryFilter {
  dimension: string
  operator: FilterOperator
  values: string[]
}

/**
 * Time dimension in a semantic query
 */
export interface TimeDimensionQuery {
  dimension: string
  granularity?: Granularity
  dateRange?: [string, string]
}

/**
 * Order specification
 */
export interface OrderSpec {
  id: string
  desc: boolean
}

/**
 * Semantic query structure
 */
export interface SemanticQuery {
  measures?: string[]
  dimensions?: string[]
  timeDimensions?: TimeDimensionQuery[]
  filters?: QueryFilter[]
  order?: OrderSpec[]
  limit?: number
  offset?: number
  /** @internal Security filters injected by MetricsAccessControl */
  _securityFilters?: string[]
  /** @internal Column masks injected by MetricsAccessControl */
  _columnMasks?: Record<string, string>
}

/**
 * Query result
 */
export interface QueryResult {
  data: Record<string, unknown>[]
  sql: string
  usedPreAggregation?: string
  meta?: {
    columns: Array<{
      name: string
      type: string
    }>
  }
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled: boolean
  ttl?: number
  maxEntries?: number
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number
  misses: number
  entries: number
}

/**
 * Query executor interface
 */
export interface QueryExecutor {
  execute(sql: string): Promise<QueryResult>
}

/**
 * SemanticLayer configuration
 */
export interface SemanticLayerConfig {
  sqlDialect?: SQLDialect
  schemaPath?: string
  executor?: QueryExecutor
  cache?: CacheConfig
}

/**
 * Cube metadata for introspection
 */
export interface CubeMeta {
  name: string
  measures: Array<{
    name: string
    type: MetricType
    description?: string
  }>
  dimensions: Array<{
    name: string
    type: DimensionType
    description?: string
  }>
  joins?: Array<{
    name: string
    relationship: JoinRelationship
  }>
}

/**
 * Schema metadata
 */
export interface SchemaMeta {
  cubes: CubeMeta[]
}

// =============================================================================
// HELPER CLASSES
// =============================================================================

/**
 * Metric helper class for SQL generation
 */
export class Metric {
  public readonly name: string
  public readonly type: MetricType
  public readonly sql?: string
  public readonly description?: string
  public readonly format?: string

  constructor(name: string, definition: MetricDefinition) {
    this.name = name
    this.type = definition.type
    this.sql = definition.sql
    this.description = definition.description
    this.format = definition.format
  }

  /**
   * Generate SQL fragment for this metric
   */
  toSQL(tableName: string, alias?: string): string {
    const col = this.sql || '*'
    const as = alias || this.name

    switch (this.type) {
      case 'count':
        return `COUNT(*) AS ${as}`
      case 'sum':
        return `SUM(${tableName}.${col}) AS ${as}`
      case 'avg':
        return `AVG(${tableName}.${col}) AS ${as}`
      case 'min':
        return `MIN(${tableName}.${col}) AS ${as}`
      case 'max':
        return `MAX(${tableName}.${col}) AS ${as}`
      case 'countDistinct':
        return `COUNT(DISTINCT ${tableName}.${col}) AS ${as}`
      case 'custom':
        return `(${this.sql}) AS ${as}`
      default:
        throw new SemanticLayerError(`Unknown metric type: ${this.type}`)
    }
  }
}

/**
 * Dimension helper class for SQL generation
 */
export class Dimension {
  public readonly name: string
  public readonly type: DimensionType
  public readonly sql: string
  public readonly description?: string

  constructor(name: string, definition: DimensionDefinition) {
    this.name = name
    this.type = definition.type
    this.sql = definition.sql
    this.description = definition.description
  }

  /**
   * Generate SQL fragment for this dimension
   */
  toSQL(
    tableName: string,
    options?: { granularity?: Granularity; dialect?: SQLDialect }
  ): string {
    const col = `${tableName}.${this.sql}`

    if (this.type === 'time' && options?.granularity) {
      return this.timeToSQL(col, options.granularity, options.dialect || 'postgres')
    }

    return col
  }

  private timeToSQL(
    col: string,
    granularity: Granularity,
    dialect: SQLDialect
  ): string {
    switch (dialect) {
      case 'postgres':
      case 'duckdb':
        return `date_trunc('${granularity}', ${col})`
      case 'clickhouse':
        return this.clickhouseTimeTrunc(col, granularity)
      case 'sqlite':
        return this.sqliteTimeTrunc(col, granularity)
      case 'mysql':
        return this.mysqlTimeTrunc(col, granularity)
      default:
        return `date_trunc('${granularity}', ${col})`
    }
  }

  private clickhouseTimeTrunc(col: string, granularity: Granularity): string {
    switch (granularity) {
      case 'second':
        return `toStartOfSecond(${col})`
      case 'minute':
        return `toStartOfMinute(${col})`
      case 'hour':
        return `toStartOfHour(${col})`
      case 'day':
        return `toDate(${col})`
      case 'week':
        return `toStartOfWeek(${col})`
      case 'month':
        return `toStartOfMonth(${col})`
      case 'quarter':
        return `toStartOfQuarter(${col})`
      case 'year':
        return `toStartOfYear(${col})`
      default:
        return `toDate(${col})`
    }
  }

  private sqliteTimeTrunc(col: string, granularity: Granularity): string {
    switch (granularity) {
      case 'second':
        return `strftime('%Y-%m-%d %H:%M:%S', ${col})`
      case 'minute':
        return `strftime('%Y-%m-%d %H:%M:00', ${col})`
      case 'hour':
        return `strftime('%Y-%m-%d %H:00:00', ${col})`
      case 'day':
        return `date(${col})`
      case 'week':
        return `date(${col}, 'weekday 0', '-6 days')`
      case 'month':
        return `strftime('%Y-%m-01', ${col})`
      case 'quarter':
        return `strftime('%Y-', ${col}) || printf('%02d', ((cast(strftime('%m', ${col}) as integer) - 1) / 3) * 3 + 1) || '-01'`
      case 'year':
        return `strftime('%Y-01-01', ${col})`
      default:
        return `date(${col})`
    }
  }

  private mysqlTimeTrunc(col: string, granularity: Granularity): string {
    switch (granularity) {
      case 'second':
        return `DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:%s')`
      case 'minute':
        return `DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:00')`
      case 'hour':
        return `DATE_FORMAT(${col}, '%Y-%m-%d %H:00:00')`
      case 'day':
        return `DATE(${col})`
      case 'week':
        return `DATE(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY))`
      case 'month':
        return `DATE_FORMAT(${col}, '%Y-%m-01')`
      case 'quarter':
        return `MAKEDATE(YEAR(${col}), 1) + INTERVAL QUARTER(${col}) QUARTER - INTERVAL 1 QUARTER`
      case 'year':
        return `DATE_FORMAT(${col}, '%Y-01-01')`
      default:
        return `DATE(${col})`
    }
  }
}

/**
 * Pre-aggregation helper class
 */
export class PreAggregation {
  public readonly name: string
  public readonly measures: string[]
  public readonly dimensions: string[]
  public readonly timeDimension?: string
  public readonly granularity?: Granularity
  public readonly refreshKey?: { every?: string; sql?: string }

  constructor(name: string, definition: Omit<PreAggregationDefinition, 'name'>) {
    this.name = name
    this.measures = definition.measures
    this.dimensions = definition.dimensions
    this.timeDimension = definition.timeDimension
    this.granularity = definition.granularity
    this.refreshKey = definition.refreshKey
  }

  /**
   * Check if a query can be served by this pre-aggregation
   */
  matches(query: {
    measures: string[]
    dimensions: string[]
    timeDimension?: string
    granularity?: Granularity
  }): boolean {
    // All query measures must be in pre-agg measures
    const measuresMatch = query.measures.every((m) =>
      this.measures.includes(m)
    )

    // All query dimensions must be in pre-agg dimensions
    const dimensionsMatch = query.dimensions.every((d) =>
      this.dimensions.includes(d)
    )

    // Time dimension and granularity must match if specified
    const timeMatch =
      !this.timeDimension ||
      (query.timeDimension === this.timeDimension &&
        query.granularity === this.granularity)

    return measuresMatch && dimensionsMatch && timeMatch
  }
}

/**
 * Cube helper class
 */
export class Cube {
  public readonly name: string
  public readonly sql: string
  public readonly measures: Record<string, MetricDefinition>
  public readonly dimensions: Record<string, DimensionDefinition>
  public readonly joins?: JoinDefinition[]
  public preAggregations: PreAggregationDefinition[] = []

  private _metrics: Map<string, Metric> = new Map()
  private _dimensions: Map<string, Dimension> = new Map()

  constructor(definition: CubeDefinition) {
    this.name = definition.name
    this.sql = definition.sql
    this.measures = definition.measures
    this.dimensions = definition.dimensions
    this.joins = definition.joins
    this.preAggregations = definition.preAggregations || []

    // Build helper instances
    for (const [name, def] of Object.entries(definition.measures)) {
      this._metrics.set(name, new Metric(name, def))
    }
    for (const [name, def] of Object.entries(definition.dimensions)) {
      this._dimensions.set(name, new Dimension(name, def))
    }
  }

  getMeasure(name: string): Metric | undefined {
    return this._metrics.get(name)
  }

  getDimension(name: string): Dimension | undefined {
    return this._dimensions.get(name)
  }
}

// =============================================================================
// CACHE IMPLEMENTATION
// =============================================================================

interface CacheEntry {
  result: QueryResult
  timestamp: number
}

class QueryCache {
  private cache: Map<string, CacheEntry> = new Map()
  private hits = 0
  private misses = 0
  private ttl: number
  private maxEntries: number

  constructor(config: CacheConfig) {
    this.ttl = config.ttl || 60000 // Default 1 minute
    this.maxEntries = config.maxEntries || 1000
  }

  get(key: string): QueryResult | undefined {
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return undefined
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      this.misses++
      return undefined
    }

    this.hits++
    return entry.result
  }

  set(key: string, result: QueryResult): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    })
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear()
      return
    }

    // Invalidate entries matching pattern (cube name)
    const keysToDelete: string[] = []
    this.cache.forEach((_, key) => {
      if (key.includes(pattern)) {
        keysToDelete.push(key)
      }
    })
    keysToDelete.forEach((key) => this.cache.delete(key))
  }

  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
    }
  }
}

// =============================================================================
// SQL GENERATOR
// =============================================================================

class SQLGenerator {
  private dialect: SQLDialect

  constructor(dialect: SQLDialect = 'postgres') {
    this.dialect = dialect
  }

  generate(
    cubes: Map<string, Cube>,
    query: SemanticQuery,
    parsedQuery: ParsedQuery
  ): string {
    const parts: string[] = []

    // SELECT clause (with optional column masks from security context)
    parts.push(this.generateSelect(cubes, parsedQuery, query._columnMasks))

    // FROM clause
    parts.push(this.generateFrom(cubes, parsedQuery))

    // JOIN clauses
    const joins = this.generateJoins(cubes, parsedQuery)
    if (joins) {
      parts.push(joins)
    }

    // WHERE clause
    const where = this.generateWhere(cubes, query, parsedQuery)
    if (where) {
      parts.push(where)
    }

    // GROUP BY clause
    const groupBy = this.generateGroupBy(cubes, parsedQuery)
    if (groupBy) {
      parts.push(groupBy)
    }

    // ORDER BY clause
    if (query.order && query.order.length > 0) {
      parts.push(this.generateOrderBy(cubes, query, parsedQuery))
    }

    // LIMIT and OFFSET
    if (query.limit !== undefined) {
      parts.push(`LIMIT ${query.limit}`)
      if (query.offset !== undefined) {
        parts.push(`OFFSET ${query.offset}`)
      }
    }

    return parts.join('\n')
  }

  private generateSelect(
    cubes: Map<string, Cube>,
    parsedQuery: ParsedQuery,
    columnMasks?: Record<string, string>
  ): string {
    const columns: string[] = []

    // Add dimensions
    for (const dim of parsedQuery.dimensions) {
      const cube = cubes.get(dim.cubeName)!
      const dimension = cube.getDimension(dim.name)!

      if (dim.granularity) {
        const sql = dimension.toSQL(dim.cubeName, {
          granularity: dim.granularity,
          dialect: this.dialect,
        })
        columns.push(`${sql} AS ${dim.alias || dim.name}`)
      } else {
        // Check if this dimension has a column mask applied
        const maskSql = columnMasks?.[dim.name]
        if (maskSql) {
          columns.push(`${maskSql} AS ${dim.alias || dim.name}`)
        } else {
          columns.push(`${dimension.toSQL(dim.cubeName)} AS ${dim.alias || dim.name}`)
        }
      }
    }

    // Add measures
    for (const measure of parsedQuery.measures) {
      const cube = cubes.get(measure.cubeName)!
      const metric = cube.getMeasure(measure.name)!
      columns.push(metric.toSQL(measure.cubeName, measure.alias))
    }

    return `SELECT\n  ${columns.join(',\n  ')}`
  }

  private generateFrom(
    cubes: Map<string, Cube>,
    parsedQuery: ParsedQuery
  ): string {
    const primaryCube = cubes.get(parsedQuery.primaryCube)!
    return `FROM (${primaryCube.sql}) AS ${primaryCube.name}`
  }

  private generateJoins(
    cubes: Map<string, Cube>,
    parsedQuery: ParsedQuery
  ): string | null {
    if (parsedQuery.joinedCubes.length === 0) {
      return null
    }

    const joins: string[] = []
    const primaryCube = cubes.get(parsedQuery.primaryCube)!

    for (const joinedCubeName of parsedQuery.joinedCubes) {
      const joinedCube = cubes.get(joinedCubeName)!

      // Find join definition
      const joinDef = primaryCube.joins?.find((j) => j.name === joinedCubeName)
      if (!joinDef) {
        continue
      }

      // Replace template variables in SQL
      const joinSql = joinDef.sql
        .replace(/\${(\w+)}/g, (_, name) => name)

      joins.push(`JOIN (${joinedCube.sql}) AS ${joinedCubeName} ON ${joinSql}`)
    }

    return joins.join('\n')
  }

  private generateWhere(
    cubes: Map<string, Cube>,
    query: SemanticQuery,
    parsedQuery: ParsedQuery
  ): string | null {
    const conditions: string[] = []

    // SECURITY: Add security filters first (row-level security)
    // These are injected by MetricsAccessControl and cannot be bypassed
    if (query._securityFilters && query._securityFilters.length > 0) {
      conditions.push(...query._securityFilters)
    }

    // Process filters
    if (query.filters) {
      for (const filter of query.filters) {
        const { cubeName, name } = this.parseRef(filter.dimension)
        const cube = cubes.get(cubeName)!
        const dimension = cube.getDimension(name)!
        const col = `${cubeName}.${dimension.sql}`

        conditions.push(this.filterToSQL(col, filter))
      }
    }

    // Process time dimension date ranges
    if (query.timeDimensions) {
      for (const td of query.timeDimensions) {
        if (td.dateRange && td.dateRange.length === 2) {
          const { cubeName, name } = this.parseRef(td.dimension)
          const cube = cubes.get(cubeName)!
          const dimension = cube.getDimension(name)!
          const col = `${cubeName}.${dimension.sql}`

          conditions.push(`${col} >= '${td.dateRange[0]}'`)
          conditions.push(`${col} <= '${td.dateRange[1]}'`)
        }
      }
    }

    if (conditions.length === 0) {
      return null
    }

    return `WHERE ${conditions.join('\n  AND ')}`
  }

  private filterToSQL(col: string, filter: QueryFilter): string {
    const { operator, values } = filter
    const val = values[0]

    switch (operator) {
      case 'equals':
        return `${col} = '${val}'`
      case 'notEquals':
        return `${col} <> '${val}'`
      case 'gt':
        return `${col} > ${val}`
      case 'gte':
        return `${col} >= ${val}`
      case 'lt':
        return `${col} < ${val}`
      case 'lte':
        return `${col} <= ${val}`
      case 'in':
        return `${col} IN (${values.map((v) => `'${v}'`).join(', ')})`
      case 'notIn':
        return `${col} NOT IN (${values.map((v) => `'${v}'`).join(', ')})`
      case 'contains':
        return `${col} LIKE '%${val}%'`
      case 'notContains':
        return `${col} NOT LIKE '%${val}%'`
      case 'startsWith':
        return `${col} LIKE '${val}%'`
      case 'endsWith':
        return `${col} LIKE '%${val}'`
      case 'between':
        return `${col} BETWEEN '${values[0]}' AND '${values[1]}'`
      case 'isNull':
        return `${col} IS NULL`
      case 'isNotNull':
        return `${col} IS NOT NULL`
      default:
        throw new InvalidQueryError(`Unknown filter operator: ${operator}`)
    }
  }

  private generateGroupBy(
    cubes: Map<string, Cube>,
    parsedQuery: ParsedQuery
  ): string | null {
    if (parsedQuery.dimensions.length === 0) {
      return null
    }

    const columns: string[] = []

    for (const dim of parsedQuery.dimensions) {
      const cube = cubes.get(dim.cubeName)!
      const dimension = cube.getDimension(dim.name)!

      if (dim.granularity) {
        const sql = dimension.toSQL(dim.cubeName, {
          granularity: dim.granularity,
          dialect: this.dialect,
        })
        columns.push(sql)
      } else {
        columns.push(dimension.toSQL(dim.cubeName))
      }
    }

    return `GROUP BY ${columns.join(', ')}`
  }

  private generateOrderBy(
    cubes: Map<string, Cube>,
    query: SemanticQuery,
    parsedQuery: ParsedQuery
  ): string {
    const orders: string[] = []

    for (const order of query.order!) {
      const { cubeName, name } = this.parseRef(order.id)

      // Check if it's a measure or dimension
      const cube = cubes.get(cubeName)
      if (!cube) continue

      const measure = cube.getMeasure(name)
      const dimension = cube.getDimension(name)

      let col: string
      if (measure) {
        col = name // Use alias
      } else if (dimension) {
        col = dimension.toSQL(cubeName)
      } else {
        col = name
      }

      orders.push(`${col} ${order.desc ? 'DESC' : 'ASC'}`)
    }

    return `ORDER BY ${orders.join(', ')}`
  }

  private parseRef(ref: string): { cubeName: string; name: string } {
    const [cubeName, name] = ref.split('.')
    return { cubeName: cubeName!, name: name! }
  }
}

// =============================================================================
// QUERY PARSER
// =============================================================================

interface ParsedMeasure {
  cubeName: string
  name: string
  alias?: string
}

interface ParsedDimension {
  cubeName: string
  name: string
  alias?: string
  granularity?: Granularity
}

interface ParsedQuery {
  primaryCube: string
  measures: ParsedMeasure[]
  dimensions: ParsedDimension[]
  joinedCubes: string[]
}

class QueryParser {
  parse(
    query: SemanticQuery,
    cubes: Map<string, Cube>
  ): ParsedQuery {
    const measures: ParsedMeasure[] = []
    const dimensions: ParsedDimension[] = []
    const cubeNames = new Set<string>()

    // Parse measures
    if (query.measures) {
      for (const ref of query.measures) {
        const parsed = this.parseRef(ref)
        this.validateMeasure(parsed, cubes)
        measures.push(parsed)
        cubeNames.add(parsed.cubeName)
      }
    }

    // Parse dimensions
    if (query.dimensions) {
      for (const ref of query.dimensions) {
        const parsed = this.parseRef(ref) as ParsedDimension
        this.validateDimension(parsed, cubes)
        dimensions.push(parsed)
        cubeNames.add(parsed.cubeName)
      }
    }

    // Parse time dimensions
    if (query.timeDimensions) {
      for (const td of query.timeDimensions) {
        const parsed = this.parseRef(td.dimension) as ParsedDimension
        parsed.granularity = td.granularity
        this.validateDimension(parsed, cubes)
        dimensions.push(parsed)
        cubeNames.add(parsed.cubeName)
      }
    }

    // Parse filters for cube references
    if (query.filters) {
      for (const filter of query.filters) {
        const { cubeName } = this.parseRef(filter.dimension)
        cubeNames.add(cubeName)
      }
    }

    // Determine primary cube and joined cubes
    const cubeList = Array.from(cubeNames)
    const primaryCube = cubeList[0]!
    const joinedCubes = cubeList.slice(1)

    return {
      primaryCube,
      measures,
      dimensions,
      joinedCubes,
    }
  }

  private parseRef(ref: string): ParsedMeasure {
    const parts = ref.split('.')
    if (parts.length !== 2) {
      throw new InvalidQueryError(
        `Invalid reference format: ${ref}. Expected 'cube.member'`
      )
    }
    return {
      cubeName: parts[0]!,
      name: parts[1]!,
    }
  }

  private validateMeasure(
    parsed: ParsedMeasure,
    cubes: Map<string, Cube>
  ): void {
    const cube = cubes.get(parsed.cubeName)
    if (!cube) {
      throw new CubeNotFoundError(parsed.cubeName)
    }
    if (!cube.getMeasure(parsed.name)) {
      throw new InvalidQueryError(
        `Measure '${parsed.name}' not found in cube '${parsed.cubeName}'`
      )
    }
  }

  private validateDimension(
    parsed: ParsedDimension,
    cubes: Map<string, Cube>
  ): void {
    const cube = cubes.get(parsed.cubeName)
    if (!cube) {
      throw new CubeNotFoundError(parsed.cubeName)
    }
    if (!cube.getDimension(parsed.name)) {
      throw new InvalidQueryError(
        `Dimension '${parsed.name}' not found in cube '${parsed.cubeName}'`
      )
    }
  }
}

// =============================================================================
// SEMANTIC LAYER MAIN CLASS
// =============================================================================

/**
 * SemanticLayer - Main class for defining and querying business metrics
 */
export class SemanticLayer {
  private cubes: Map<string, Cube> = new Map()
  private config: SemanticLayerConfig
  private sqlGenerator: SQLGenerator
  private queryParser: QueryParser
  private cache?: QueryCache
  private validMetricTypes = new Set<MetricType>([
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'countDistinct',
    'custom',
  ])
  private validDimensionTypes = new Set<DimensionType>([
    'string',
    'number',
    'time',
    'boolean',
    'geo',
  ])
  private validFilterOperators = new Set<FilterOperator>([
    'equals',
    'notEquals',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'notIn',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'between',
    'isNull',
    'isNotNull',
  ])

  constructor(config: SemanticLayerConfig = {}) {
    this.config = config
    this.sqlGenerator = new SQLGenerator(config.sqlDialect)
    this.queryParser = new QueryParser()

    if (config.cache?.enabled) {
      this.cache = new QueryCache(config.cache)
    }
  }

  /**
   * Define a new cube in the semantic layer
   */
  defineCube(definition: CubeDefinition): void {
    // Validate cube name
    if (!definition.name || definition.name.trim() === '') {
      throw new SemanticLayerError('Cube name is required')
    }

    // Check for duplicate
    if (this.cubes.has(definition.name)) {
      throw new SemanticLayerError(
        `Cube '${definition.name}' is already defined`
      )
    }

    // Validate measures
    for (const [name, measure] of Object.entries(definition.measures)) {
      if (!this.validMetricTypes.has(measure.type)) {
        throw new SemanticLayerError(
          `Invalid metric type '${measure.type}' for measure '${name}'`
        )
      }
      if (measure.type !== 'count' && !measure.sql) {
        throw new SemanticLayerError(
          `SQL is required for ${measure.type} measure '${name}'`
        )
      }
    }

    // Validate dimensions
    for (const [name, dimension] of Object.entries(definition.dimensions)) {
      if (!this.validDimensionTypes.has(dimension.type)) {
        throw new SemanticLayerError(
          `Invalid dimension type '${dimension.type}' for dimension '${name}'`
        )
      }
      if (!dimension.sql) {
        throw new SemanticLayerError(
          `SQL is required for dimension '${name}'`
        )
      }
    }

    // Create and store cube
    const cube = new Cube(definition)
    this.cubes.set(definition.name, cube)
  }

  /**
   * Get all defined cubes
   */
  getCubes(): Cube[] {
    return Array.from(this.cubes.values())
  }

  /**
   * Get a specific cube by name
   */
  getCube(name: string): Cube | undefined {
    return this.cubes.get(name)
  }

  /**
   * Define a pre-aggregation for a cube
   */
  definePreAggregation(
    cubeName: string,
    definition: PreAggregationDefinition
  ): void {
    const cube = this.cubes.get(cubeName)
    if (!cube) {
      throw new CubeNotFoundError(cubeName)
    }

    // Validate measures exist
    for (const measureName of definition.measures) {
      if (!cube.getMeasure(measureName)) {
        throw new InvalidQueryError(
          `Measure '${measureName}' not found in cube '${cubeName}'`
        )
      }
    }

    // Validate dimensions exist
    for (const dimName of definition.dimensions) {
      if (!cube.getDimension(dimName)) {
        throw new InvalidQueryError(
          `Dimension '${dimName}' not found in cube '${cubeName}'`
        )
      }
    }

    // Check for duplicate name
    if (cube.preAggregations.some((pa) => pa.name === definition.name)) {
      throw new SemanticLayerError(
        `Pre-aggregation '${definition.name}' already exists in cube '${cubeName}'`
      )
    }

    cube.preAggregations.push(definition)
  }

  /**
   * Execute a semantic query
   */
  async query(query: SemanticQuery): Promise<QueryResult> {
    // Validate query
    this.validateQuery(query)

    // Check cache
    if (this.cache) {
      const cacheKey = this.getCacheKey(query)
      const cached = this.cache.get(cacheKey)
      if (cached) {
        return cached
      }
    }

    // Parse query
    const parsedQuery = this.queryParser.parse(query, this.cubes)

    // Check for pre-aggregation match
    const preAgg = this.findMatchingPreAggregation(query, parsedQuery)

    // Generate SQL
    const sql = this.sqlGenerator.generate(this.cubes, query, parsedQuery)

    // Execute if executor provided, otherwise return SQL only
    let result: QueryResult
    if (this.config.executor) {
      result = await this.config.executor.execute(sql)
      result.sql = sql
    } else {
      result = {
        data: [],
        sql,
      }
    }

    // Add pre-aggregation info
    if (preAgg) {
      result.usedPreAggregation = preAgg.name
    }

    // Cache result
    if (this.cache) {
      const cacheKey = this.getCacheKey(query)
      this.cache.set(cacheKey, result)
    }

    return result
  }

  private validateQuery(query: SemanticQuery): void {
    // Must have at least measures or dimensions
    if (
      (!query.measures || query.measures.length === 0) &&
      (!query.dimensions || query.dimensions.length === 0) &&
      (!query.timeDimensions || query.timeDimensions.length === 0)
    ) {
      throw new InvalidQueryError(
        'Query must have at least one measure, dimension, or time dimension'
      )
    }

    // Validate filter operators
    if (query.filters) {
      for (const filter of query.filters) {
        if (!this.validFilterOperators.has(filter.operator)) {
          throw new InvalidQueryError(
            `Invalid filter operator: ${filter.operator}`
          )
        }
      }
    }
  }

  private findMatchingPreAggregation(
    query: SemanticQuery,
    parsedQuery: ParsedQuery
  ): PreAggregationDefinition | undefined {
    const cube = this.cubes.get(parsedQuery.primaryCube)
    if (!cube || !cube.preAggregations.length) {
      return undefined
    }

    // Extract query info for matching
    const queryMeasures = parsedQuery.measures.map((m) => m.name)
    const queryDimensions = parsedQuery.dimensions
      .filter((d) => !d.granularity)
      .map((d) => d.name)
    const timeDim = parsedQuery.dimensions.find((d) => d.granularity)

    // Find first matching pre-aggregation
    for (const preAgg of cube.preAggregations) {
      const pa = new PreAggregation(preAgg.name, preAgg)
      const matches = pa.matches({
        measures: queryMeasures,
        dimensions: queryDimensions,
        timeDimension: timeDim?.name,
        granularity: timeDim?.granularity,
      })
      if (matches) {
        return preAgg
      }
    }

    return undefined
  }

  private getCacheKey(query: SemanticQuery): string {
    return JSON.stringify(query)
  }

  /**
   * Invalidate cache for a specific cube
   */
  invalidateCache(cubeName: string): void {
    if (this.cache) {
      this.cache.invalidate(cubeName)
    }
  }

  /**
   * Invalidate all cache entries
   */
  invalidateAllCache(): void {
    if (this.cache) {
      this.cache.invalidate()
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    if (!this.cache) {
      return { hits: 0, misses: 0, entries: 0 }
    }
    return this.cache.getStats()
  }

  /**
   * Get SQL for creating a pre-aggregation table
   */
  getPreAggregationSQL(cubeName: string, preAggName: string): string {
    const cube = this.cubes.get(cubeName)
    if (!cube) {
      throw new CubeNotFoundError(cubeName)
    }

    const preAgg = cube.preAggregations.find((pa) => pa.name === preAggName)
    if (!preAgg) {
      throw new SemanticLayerError(
        `Pre-aggregation '${preAggName}' not found in cube '${cubeName}'`
      )
    }

    // Generate CREATE TABLE AS SELECT
    const measures = preAgg.measures
      .map((name) => {
        const metric = cube.getMeasure(name)!
        return metric.toSQL(cubeName, name)
      })
      .join(',\n  ')

    const dimensions = preAgg.dimensions
      .map((name) => {
        const dim = cube.getDimension(name)!
        return `${dim.toSQL(cubeName)} AS ${name}`
      })
      .join(',\n  ')

    let timeDimension = ''
    if (preAgg.timeDimension && preAgg.granularity) {
      const dim = cube.getDimension(preAgg.timeDimension)!
      const sql = dim.toSQL(cubeName, {
        granularity: preAgg.granularity,
        dialect: this.config.sqlDialect || 'postgres',
      })
      timeDimension = `,\n  ${sql} AS ${preAgg.timeDimension}_${preAgg.granularity}`
    }

    const groupByColumns = [
      ...preAgg.dimensions.map((name) => {
        const dim = cube.getDimension(name)!
        return dim.toSQL(cubeName)
      }),
    ]

    if (preAgg.timeDimension && preAgg.granularity) {
      const dim = cube.getDimension(preAgg.timeDimension)!
      groupByColumns.push(
        dim.toSQL(cubeName, {
          granularity: preAgg.granularity,
          dialect: this.config.sqlDialect || 'postgres',
        })
      )
    }

    return `CREATE TABLE ${cubeName}_${preAggName} AS
SELECT
  ${dimensions}${timeDimension},
  ${measures}
FROM (${cube.sql}) AS ${cubeName}
GROUP BY ${groupByColumns.join(', ')}`
  }

  /**
   * Get SQL for refreshing a pre-aggregation
   */
  getPreAggregationRefreshSQL(cubeName: string, preAggName: string): string {
    const createSQL = this.getPreAggregationSQL(cubeName, preAggName)
    const tableName = `${cubeName}_${preAggName}`

    return `DROP TABLE IF EXISTS ${tableName};\n${createSQL}`
  }

  /**
   * Get schema metadata for introspection
   */
  getMeta(): SchemaMeta {
    const cubes: CubeMeta[] = []

    this.cubes.forEach((cube) => {
      const measures = Object.entries(cube.measures).map(([name, def]) => ({
        name,
        type: (def as MetricDefinition).type,
        description: (def as MetricDefinition).description,
      }))

      const dimensions = Object.entries(cube.dimensions).map(([name, def]) => ({
        name,
        type: (def as DimensionDefinition).type,
        description: (def as DimensionDefinition).description,
      }))

      const joins = cube.joins?.map((j) => ({
        name: j.name,
        relationship: j.relationship,
      }))

      cubes.push({
        name: cube.name,
        measures,
        dimensions,
        joins,
      })
    })

    return { cubes }
  }
}

// =============================================================================
// Re-export Cube DSL
// =============================================================================

export {
  // Core factory
  cube as cubeDSL,

  // Measure helpers
  count as countMeasure,
  sum as sumMeasure,
  avg as avgMeasure,
  min as minMeasure,
  max as maxMeasure,
  countDistinct as countDistinctMeasure,

  // Dimension helpers
  time as timeDimension,
  categorical as categoricalDimension,
  numeric as numericDimension,
  boolean as booleanDimension,

  // Join helpers
  oneToOne,
  oneToMany,
  manyToMany,

  // Segment helper
  segment as segmentDSL,

  // Validation
  validateCube,
  CubeValidationError,

  // Types
  type CubeDefinition as CubeDSLDefinition,
  type CubeInput,
  type MeasureDefinition as DSLMeasureDefinition,
  type DimensionDefinition as DSLDimensionDefinition,
  type JoinDefinition as DSLJoinDefinition,
  type SegmentDefinition as DSLSegmentDefinition,
  type MeasureOptions,
  type DimensionOptions,
  type SegmentOptions,
  type JoinSqlOptions,
  type ManyToManyOptions,
} from './cube-dsl'
