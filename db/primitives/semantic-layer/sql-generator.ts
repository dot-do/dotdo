/**
 * SQL Generator - Converts semantic queries to optimized SQL
 *
 * Features:
 * - Dialect-specific SQL (Postgres, ClickHouse, DuckDB, SQLite)
 * - Measure aggregations (count, sum, avg, min, max, countDistinct)
 * - Dimension grouping with time granularity
 * - JOIN clause generation for multi-cube queries
 * - Filter pushdown optimization
 *
 * @example
 * ```typescript
 * const generator = new SQLGenerator({ cubes, dialect: 'postgres' })
 *
 * const sql = generator.generate({
 *   measures: ['Orders.revenue', 'Orders.count'],
 *   dimensions: ['Orders.createdAt.month', 'Products.category'],
 *   filters: [{ member: 'Orders.status', operator: 'equals', values: ['completed'] }],
 *   order: [['Orders.revenue', 'desc']],
 *   limit: 100,
 * })
 * ```
 *
 * @see dotdo-yilsq
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Supported SQL dialects
 */
export type SQLDialect = 'postgres' | 'clickhouse' | 'duckdb' | 'sqlite'

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
 * Measure types
 */
export type MeasureType =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'countDistinct'
  | 'number'

/**
 * Dimension types
 */
export type DimensionType = 'string' | 'number' | 'time' | 'boolean' | 'geo'

/**
 * Join relationship types
 */
export type JoinRelationship = 'belongsTo' | 'hasMany' | 'hasOne'

/**
 * Filter operator types
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
  | 'between'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'set'
  | 'notSet'

/**
 * Measure definition
 */
export interface MeasureDefinition {
  type: MeasureType
  sql?: string
  description?: string
}

/**
 * Dimension definition
 */
export interface DimensionDefinition {
  type: DimensionType
  sql: string
  primaryKey?: boolean
  description?: string
}

/**
 * Join definition
 */
export interface JoinDefinition {
  relationship: JoinRelationship
  sql: string
}

/**
 * Cube definition
 */
export interface CubeDefinition {
  name: string
  sql: string
  sqlAlias?: string
  measures: Record<string, MeasureDefinition>
  dimensions: Record<string, DimensionDefinition>
  joins?: Record<string, JoinDefinition>
}

/**
 * Filter in a semantic query
 */
export interface QueryFilter {
  member: string
  operator: FilterOperator
  values: string[]
}

/**
 * Semantic query structure
 */
export interface SemanticQuery {
  measures?: string[]
  dimensions?: string[]
  filters?: QueryFilter[]
  order?: [string, 'asc' | 'desc'][]
  limit?: number
  offset?: number
}

/**
 * SQL Generator configuration
 */
export interface SQLGeneratorConfig {
  cubes: Map<string, CubeDefinition>
  dialect: SQLDialect
  enableFilterPushdown?: boolean
}

// =============================================================================
// ERROR CLASSES
// =============================================================================

export class SQLGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SQLGenerationError'
  }
}

// =============================================================================
// SQL PARTS INTERFACE
// =============================================================================

interface SQLParts {
  select: string[]
  from: string
  joins: string[]
  where: string[]
  having: string[]
  groupBy: string[]
  orderBy: string[]
  limit?: number
  offset?: number
}

interface ParsedMember {
  cubeName: string
  memberName: string
  granularity?: Granularity
}

// =============================================================================
// DIALECT-SPECIFIC TIME TRUNCATION
// =============================================================================

const VALID_FILTER_OPERATORS = new Set<FilterOperator>([
  'equals',
  'notEquals',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'between',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'set',
  'notSet',
])

function getTimeTruncSQL(
  column: string,
  granularity: Granularity,
  dialect: SQLDialect
): string {
  switch (dialect) {
    case 'postgres':
    case 'duckdb':
      return `date_trunc('${granularity}', ${column})`

    case 'clickhouse':
      switch (granularity) {
        case 'second':
          return `toStartOfSecond(${column})`
        case 'minute':
          return `toStartOfMinute(${column})`
        case 'hour':
          return `toStartOfHour(${column})`
        case 'day':
          return `toDate(${column})`
        case 'week':
          return `toStartOfWeek(${column})`
        case 'month':
          return `toStartOfMonth(${column})`
        case 'quarter':
          return `toStartOfQuarter(${column})`
        case 'year':
          return `toStartOfYear(${column})`
        default:
          return `toDate(${column})`
      }

    case 'sqlite':
      switch (granularity) {
        case 'second':
          return `strftime('%Y-%m-%d %H:%M:%S', ${column})`
        case 'minute':
          return `strftime('%Y-%m-%d %H:%M:00', ${column})`
        case 'hour':
          return `strftime('%Y-%m-%d %H:00:00', ${column})`
        case 'day':
          return `date(${column})`
        case 'week':
          return `date(${column}, 'weekday 0', '-6 days')`
        case 'month':
          return `strftime('%Y-%m-01', ${column})`
        case 'quarter':
          return `strftime('%Y-', ${column}) || printf('%02d', ((cast(strftime('%m', ${column}) as integer) - 1) / 3) * 3 + 1) || '-01'`
        case 'year':
          return `strftime('%Y-01-01', ${column})`
        default:
          return `date(${column})`
      }

    default:
      return `date_trunc('${granularity}', ${column})`
  }
}

// =============================================================================
// SQL GENERATOR CLASS
// =============================================================================

export class SQLGenerator {
  private cubes: Map<string, CubeDefinition>
  private dialect: SQLDialect
  private enableFilterPushdown: boolean

  constructor(config: SQLGeneratorConfig) {
    this.cubes = config.cubes
    this.dialect = config.dialect
    this.enableFilterPushdown = config.enableFilterPushdown ?? false
  }

  /**
   * Generate SQL from a semantic query
   */
  generate(query: SemanticQuery): string {
    // Validate query is not empty
    if (
      (!query.measures || query.measures.length === 0) &&
      (!query.dimensions || query.dimensions.length === 0)
    ) {
      throw new SQLGenerationError('Empty query: must have at least one measure or dimension')
    }

    const parts: SQLParts = {
      select: [],
      from: '',
      joins: [],
      where: [],
      having: [],
      groupBy: [],
      orderBy: [],
    }

    // Collect all cubes referenced in the query
    const referencedCubes = this.getReferencedCubes(query)

    if (referencedCubes.size === 0) {
      throw new SQLGenerationError('Empty query: no cubes referenced')
    }

    // Determine primary cube (first one in measures, then dimensions)
    const primaryCubeName = this.getPrimaryCube(query)
    const primaryCube = this.cubes.get(primaryCubeName)

    if (!primaryCube) {
      throw new SQLGenerationError(`Unknown cube: ${primaryCubeName}`)
    }

    // Build FROM clause
    parts.from = this.buildFromClause(primaryCube)

    // Build JOINs for other cubes
    const joinedCubes = new Set([primaryCubeName])
    for (const cubeName of referencedCubes) {
      if (cubeName !== primaryCubeName) {
        this.buildJoins(parts, primaryCubeName, cubeName, joinedCubes)
      }
    }

    // Process measures
    const hasMeasures = query.measures && query.measures.length > 0
    if (query.measures) {
      for (const measureRef of query.measures) {
        this.processMeasure(parts, measureRef)
      }
    }

    // Process dimensions
    if (query.dimensions) {
      for (const dimensionRef of query.dimensions) {
        this.processDimension(parts, dimensionRef, hasMeasures)
      }
    }

    // Process filters
    if (query.filters) {
      for (const filter of query.filters) {
        this.processFilter(parts, filter, query.measures || [])
      }
    }

    // Process order
    if (query.order) {
      for (const [member, direction] of query.order) {
        this.processOrder(parts, member, direction)
      }
    }

    // Process limit and offset
    if (query.limit !== undefined) {
      parts.limit = query.limit
    }
    if (query.offset !== undefined) {
      parts.offset = query.offset
    }

    return this.buildSQL(parts)
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private parseMember(ref: string): ParsedMember {
    const parts = ref.split('.')

    if (parts.length < 2) {
      throw new SQLGenerationError(`Invalid member reference: ${ref}`)
    }

    const cubeName = parts[0]
    const memberName = parts[1]
    const granularity = parts.length > 2 ? (parts[2] as Granularity) : undefined

    return { cubeName, memberName, granularity }
  }

  private getReferencedCubes(query: SemanticQuery): Set<string> {
    const cubes = new Set<string>()

    if (query.measures) {
      for (const ref of query.measures) {
        const { cubeName } = this.parseMember(ref)
        cubes.add(cubeName)
      }
    }

    if (query.dimensions) {
      for (const ref of query.dimensions) {
        const { cubeName } = this.parseMember(ref)
        cubes.add(cubeName)
      }
    }

    if (query.filters) {
      for (const filter of query.filters) {
        const { cubeName } = this.parseMember(filter.member)
        cubes.add(cubeName)
      }
    }

    return cubes
  }

  private getPrimaryCube(query: SemanticQuery): string {
    // First from measures
    if (query.measures && query.measures.length > 0) {
      const { cubeName } = this.parseMember(query.measures[0])
      return cubeName
    }

    // Then from dimensions
    if (query.dimensions && query.dimensions.length > 0) {
      const { cubeName } = this.parseMember(query.dimensions[0])
      return cubeName
    }

    // Then from filters
    if (query.filters && query.filters.length > 0) {
      const { cubeName } = this.parseMember(query.filters[0].member)
      return cubeName
    }

    throw new SQLGenerationError('Cannot determine primary cube')
  }

  private getCubeAlias(cube: CubeDefinition): string {
    return cube.sqlAlias || cube.name.toLowerCase()
  }

  private buildFromClause(cube: CubeDefinition): string {
    const alias = this.getCubeAlias(cube)
    return `(${cube.sql}) AS ${alias}`
  }

  private buildJoins(
    parts: SQLParts,
    fromCubeName: string,
    toCubeName: string,
    joinedCubes: Set<string>
  ): void {
    if (joinedCubes.has(toCubeName)) return

    const fromCube = this.cubes.get(fromCubeName)
    const toCube = this.cubes.get(toCubeName)

    if (!fromCube) {
      throw new SQLGenerationError(`Unknown cube: ${fromCubeName}`)
    }
    if (!toCube) {
      throw new SQLGenerationError(`Unknown cube: ${toCubeName}`)
    }

    // Find join definition
    const joinDef = fromCube.joins?.[toCubeName]
    if (!joinDef) {
      throw new SQLGenerationError(`No join defined from ${fromCubeName} to ${toCubeName}`)
    }

    joinedCubes.add(toCubeName)

    const toAlias = this.getCubeAlias(toCube)
    const fromAlias = this.getCubeAlias(fromCube)

    // Substitute ${CubeName} references in join SQL
    let joinSQL = joinDef.sql
      .replace(/\$\{(\w+)\}/g, (_, name) => {
        const cube = this.cubes.get(name)
        if (cube) {
          return this.getCubeAlias(cube)
        }
        return name.toLowerCase()
      })

    parts.joins.push(
      `LEFT JOIN (${toCube.sql}) AS ${toAlias} ON ${joinSQL}`
    )
  }

  private processMeasure(parts: SQLParts, measureRef: string): void {
    const { cubeName, memberName } = this.parseMember(measureRef)
    const cube = this.cubes.get(cubeName)

    if (!cube) {
      throw new SQLGenerationError(`Unknown cube: ${cubeName}`)
    }

    const measure = cube.measures[memberName]
    if (!measure) {
      throw new SQLGenerationError(`Unknown measure: ${measureRef}`)
    }

    const alias = this.getCubeAlias(cube)
    const sql = this.buildMeasureSQL(measure, alias)

    parts.select.push(`${sql} AS "${measureRef}"`)
  }

  private buildMeasureSQL(measure: MeasureDefinition, tableAlias: string): string {
    const column = measure.sql ? `${tableAlias}.${measure.sql}` : '*'

    switch (measure.type) {
      case 'count':
        return measure.sql ? `COUNT(${column})` : 'COUNT(*)'
      case 'sum':
        return `SUM(${column})`
      case 'avg':
        return `AVG(${column})`
      case 'min':
        return `MIN(${column})`
      case 'max':
        return `MAX(${column})`
      case 'countDistinct':
        return `COUNT(DISTINCT ${column})`
      case 'number':
        // Raw SQL expression
        return measure.sql || '0'
      default:
        throw new SQLGenerationError(`Unknown measure type: ${measure.type}`)
    }
  }

  private processDimension(
    parts: SQLParts,
    dimensionRef: string,
    hasMeasures: boolean
  ): void {
    const { cubeName, memberName, granularity } = this.parseMember(dimensionRef)
    const cube = this.cubes.get(cubeName)

    if (!cube) {
      throw new SQLGenerationError(`Unknown cube: ${cubeName}`)
    }

    const dimension = cube.dimensions[memberName]
    if (!dimension) {
      throw new SQLGenerationError(`Unknown dimension: ${dimensionRef}`)
    }

    const alias = this.getCubeAlias(cube)
    const column = `${alias}.${dimension.sql}`

    let selectSQL: string
    let groupBySQL: string

    if (dimension.type === 'time' && granularity) {
      selectSQL = getTimeTruncSQL(column, granularity, this.dialect)
      groupBySQL = selectSQL
    } else {
      selectSQL = column
      groupBySQL = column
    }

    parts.select.push(`${selectSQL} AS "${dimensionRef}"`)

    // Only add to GROUP BY if we have measures (aggregations)
    if (hasMeasures) {
      parts.groupBy.push(groupBySQL)
    }
  }

  private processFilter(
    parts: SQLParts,
    filter: QueryFilter,
    measures: string[]
  ): void {
    const { cubeName, memberName } = this.parseMember(filter.member)
    const cube = this.cubes.get(cubeName)

    if (!cube) {
      throw new SQLGenerationError(`Unknown cube: ${cubeName}`)
    }

    // Validate filter operator
    if (!VALID_FILTER_OPERATORS.has(filter.operator)) {
      throw new SQLGenerationError(`Invalid filter operator: ${filter.operator}`)
    }

    // Check if it's a measure or dimension
    const measure = cube.measures[memberName]
    const dimension = cube.dimensions[memberName]

    if (!measure && !dimension) {
      throw new SQLGenerationError(`Unknown member: ${filter.member}`)
    }

    const alias = this.getCubeAlias(cube)
    const isMeasureFilter = measure !== undefined && measures.includes(filter.member)

    let column: string
    if (measure) {
      // For measure filters, use the aggregation expression
      column = this.buildMeasureSQL(measure, alias)
    } else {
      column = `${alias}.${dimension!.sql}`
    }

    const filterSQL = this.buildFilterSQL(column, filter)

    // Measure filters go in HAVING (when filter pushdown is enabled)
    if (isMeasureFilter && this.enableFilterPushdown) {
      parts.having.push(filterSQL)
    } else {
      parts.where.push(filterSQL)
    }
  }

  private buildFilterSQL(column: string, filter: QueryFilter): string {
    const { operator, values } = filter

    switch (operator) {
      case 'equals':
        if (values.length === 1) {
          return `${column} = ${this.escapeValue(values[0])}`
        }
        return `${column} IN (${values.map((v) => this.escapeValue(v)).join(', ')})`

      case 'notEquals':
        if (values.length === 1) {
          return `${column} <> ${this.escapeValue(values[0])}`
        }
        return `${column} NOT IN (${values.map((v) => this.escapeValue(v)).join(', ')})`

      case 'gt':
        return `${column} > ${this.escapeNumeric(values[0])}`

      case 'gte':
        return `${column} >= ${this.escapeNumeric(values[0])}`

      case 'lt':
        return `${column} < ${this.escapeNumeric(values[0])}`

      case 'lte':
        return `${column} <= ${this.escapeNumeric(values[0])}`

      case 'in':
        return `${column} IN (${values.map((v) => this.escapeValue(v)).join(', ')})`

      case 'notIn':
        return `${column} NOT IN (${values.map((v) => this.escapeValue(v)).join(', ')})`

      case 'between':
        return `${column} BETWEEN ${this.escapeNumeric(values[0])} AND ${this.escapeNumeric(values[1])}`

      case 'contains':
        return `${column} LIKE '%${this.escapeString(values[0])}%'`

      case 'notContains':
        return `${column} NOT LIKE '%${this.escapeString(values[0])}%'`

      case 'startsWith':
        return `${column} LIKE '${this.escapeString(values[0])}%'`

      case 'endsWith':
        return `${column} LIKE '%${this.escapeString(values[0])}'`

      case 'set':
        return `${column} IS NOT NULL`

      case 'notSet':
        return `${column} IS NULL`

      default:
        throw new SQLGenerationError(`Unknown filter operator: ${operator}`)
    }
  }

  private escapeValue(value: string): string {
    // If it looks like a number, don't quote it
    if (!isNaN(Number(value))) {
      return value
    }
    return `'${this.escapeString(value)}'`
  }

  private escapeNumeric(value: string): string {
    // Return as-is for numeric values
    return value
  }

  private escapeString(value: string): string {
    // Escape single quotes
    return value.replace(/'/g, "''")
  }

  private processOrder(
    parts: SQLParts,
    member: string,
    direction: 'asc' | 'desc'
  ): void {
    // Use the alias from SELECT
    parts.orderBy.push(`"${member}" ${direction.toUpperCase()}`)
  }

  private buildSQL(parts: SQLParts): string {
    const lines: string[] = []

    // SELECT
    if (parts.select.length === 0) {
      lines.push('SELECT *')
    } else {
      lines.push(`SELECT\n  ${parts.select.join(',\n  ')}`)
    }

    // FROM
    lines.push(`FROM ${parts.from}`)

    // JOINs
    for (const join of parts.joins) {
      lines.push(join)
    }

    // WHERE
    if (parts.where.length > 0) {
      lines.push(`WHERE ${parts.where.join('\n  AND ')}`)
    }

    // GROUP BY
    if (parts.groupBy.length > 0) {
      lines.push(`GROUP BY ${parts.groupBy.join(', ')}`)
    }

    // HAVING
    if (parts.having.length > 0) {
      lines.push(`HAVING ${parts.having.join('\n  AND ')}`)
    }

    // ORDER BY
    if (parts.orderBy.length > 0) {
      lines.push(`ORDER BY ${parts.orderBy.join(', ')}`)
    }

    // LIMIT
    if (parts.limit !== undefined) {
      lines.push(`LIMIT ${parts.limit}`)
    }

    // OFFSET
    if (parts.offset !== undefined) {
      lines.push(`OFFSET ${parts.offset}`)
    }

    return lines.join('\n')
  }
}
