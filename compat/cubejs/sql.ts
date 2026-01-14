/**
 * @dotdo/cubejs - SQL Generation
 *
 * Generates SQL from Cube.js queries using registered cube schemas.
 * Supports joins, filters, time dimensions, and aggregations.
 *
 * @example
 * ```typescript
 * import { generateSQL } from '@dotdo/cubejs'
 *
 * const sql = generateSQL({
 *   measures: ['Orders.count', 'Orders.totalAmount'],
 *   dimensions: ['Orders.status'],
 *   filters: [{ member: 'Orders.status', operator: 'equals', values: ['completed'] }],
 * }, schemas)
 * ```
 */

import type { CubeSchema, Measure, Dimension, Granularity } from './schema'
import type { CubeQuery, Filter, LogicalFilter, TimeDimension } from './query'
import { getJoinPath } from './schema'
import { SQLGenerationError } from './errors'

// =============================================================================
// SQL Parts
// =============================================================================

interface SQLParts {
  select: string[]
  from: string
  joins: string[]
  where: string[]
  groupBy: string[]
  orderBy: string[]
  limit?: number
  offset?: number
}

// =============================================================================
// SQL Generator
// =============================================================================

/**
 * Generate SQL from a Cube.js query
 */
export function generateSQL(
  query: CubeQuery,
  schemas: Map<string, CubeSchema>
): string {
  const parts: SQLParts = {
    select: [],
    from: '',
    joins: [],
    where: [],
    groupBy: [],
    orderBy: [],
  }

  // Get all cubes referenced in the query
  const queryCubes = getQueryCubes(query)

  if (queryCubes.size === 0) {
    throw new SQLGenerationError('Query must reference at least one cube', query)
  }

  // Determine primary cube (first one referenced)
  const primaryCubeName = Array.from(queryCubes)[0]
  const primaryCube = schemas.get(primaryCubeName)

  if (!primaryCube) {
    throw new SQLGenerationError(`Unknown cube: ${primaryCubeName}`, query)
  }

  // Build FROM clause
  parts.from = buildFromClause(primaryCube)

  // Build JOINs for other cubes
  const joinedCubes = new Set([primaryCubeName])
  for (const cubeName of Array.from(queryCubes)) {
    if (cubeName !== primaryCubeName) {
      buildJoins(parts, primaryCubeName, cubeName, schemas, joinedCubes)
    }
  }

  // Process measures
  processMeasures(parts, query.measures || [], schemas)

  // Process dimensions
  processDimensions(parts, query.dimensions || [], schemas)

  // Process time dimensions
  processTimeDimensions(parts, query.timeDimensions || [], schemas)

  // Process filters
  processFilters(parts, query.filters || [], schemas)

  // Process order
  processOrder(parts, query.order, schemas)

  // Process limit/offset
  if (query.limit !== undefined) {
    parts.limit = query.limit
  }
  if (query.offset !== undefined) {
    parts.offset = query.offset
  }

  return buildSQL(parts)
}

// =============================================================================
// SQL Building Functions
// =============================================================================

/**
 * Build FROM clause from cube SQL
 */
function buildFromClause(cube: CubeSchema): string {
  const sql = cube.sqlTable
    ? cube.sqlTable
    : `(${cube.sql}) AS ${cube.sqlAlias || cube.name.toLowerCase()}`

  return sql.includes('SELECT') || sql.includes('(')
    ? sql
    : `${sql} AS ${cube.sqlAlias || cube.name.toLowerCase()}`
}

/**
 * Build JOINs between cubes
 */
function buildJoins(
  parts: SQLParts,
  fromCube: string,
  toCube: string,
  schemas: Map<string, CubeSchema>,
  joinedCubes: Set<string>
): void {
  if (joinedCubes.has(toCube)) return

  const path = getJoinPath(schemas, fromCube, toCube)
  if (!path) {
    throw new SQLGenerationError(
      `No join path from ${fromCube} to ${toCube}`
    )
  }

  // Add joins along the path
  for (let i = 0; i < path.length - 1; i++) {
    const currentCube = path[i]
    const nextCube = path[i + 1]

    if (joinedCubes.has(nextCube)) continue
    joinedCubes.add(nextCube)

    const currentSchema = schemas.get(currentCube)!
    const nextSchema = schemas.get(nextCube)!

    // Get join definition
    const join = currentSchema.joins?.[nextCube]
    if (!join) continue

    // Build join SQL
    const joinSql = buildJoinSql(currentSchema, nextSchema, join.sql, schemas)
    const joinType = join.relationship === 'hasMany' ? 'LEFT JOIN' : 'LEFT JOIN'
    const tableSql = nextSchema.sqlTable || `(${nextSchema.sql})`

    parts.joins.push(
      `${joinType} ${tableSql} AS ${nextSchema.sqlAlias || nextCube.toLowerCase()} ON ${joinSql}`
    )
  }
}

/**
 * Build join SQL with substitutions
 */
function buildJoinSql(
  fromCube: CubeSchema,
  toCube: CubeSchema,
  joinSql: string,
  schemas: Map<string, CubeSchema>
): string {
  let sql = joinSql

  // Replace ${CUBE} with current cube alias
  sql = sql.replace(/\$\{CUBE\}/g, fromCube.sqlAlias || fromCube.name.toLowerCase())

  // Replace ${CubeName} references
  for (const [name, schema] of Array.from(schemas)) {
    const regex = new RegExp(`\\$\\{${name}\\}`, 'g')
    sql = sql.replace(regex, schema.sqlAlias || name.toLowerCase())
  }

  return sql
}

/**
 * Process measures into SELECT and GROUP BY
 */
function processMeasures(
  parts: SQLParts,
  measures: string[],
  schemas: Map<string, CubeSchema>
): void {
  for (const measurePath of measures) {
    const [cubeName, measureName] = measurePath.split('.')
    const schema = schemas.get(cubeName)

    if (!schema) {
      throw new SQLGenerationError(`Unknown cube: ${cubeName}`)
    }

    const measure = schema.measures[measureName]
    if (!measure) {
      throw new SQLGenerationError(`Unknown measure: ${measurePath}`)
    }

    const alias = cubeName.toLowerCase()
    const sql = buildMeasureSql(measure, alias, schema, schemas)

    parts.select.push(`${sql} AS "${measurePath}"`)
  }
}

/**
 * Build SQL for a measure
 */
function buildMeasureSql(
  measure: Measure,
  tableAlias: string,
  cube: CubeSchema,
  schemas: Map<string, CubeSchema>
): string {
  const resolvedSql = resolveSqlExpression(measure.sql || '*', tableAlias, cube, schemas)

  switch (measure.type) {
    case 'count':
      return measure.sql ? `COUNT(${resolvedSql})` : 'COUNT(*)'
    case 'countDistinct':
      return `COUNT(DISTINCT ${resolvedSql})`
    case 'countDistinctApprox':
      return `COUNT(DISTINCT ${resolvedSql})` // Simplified, DB-specific impl would differ
    case 'sum':
      return `SUM(${resolvedSql})`
    case 'avg':
      return `AVG(${resolvedSql})`
    case 'min':
      return `MIN(${resolvedSql})`
    case 'max':
      return `MAX(${resolvedSql})`
    case 'runningTotal':
      return `SUM(${resolvedSql}) OVER (ORDER BY 1)`
    case 'number':
      return resolvedSql
    default:
      throw new SQLGenerationError(`Unknown measure type: ${measure.type}`)
  }
}

/**
 * Process dimensions into SELECT and GROUP BY
 */
function processDimensions(
  parts: SQLParts,
  dimensions: string[],
  schemas: Map<string, CubeSchema>
): void {
  for (const dimPath of dimensions) {
    const [cubeName, dimName] = dimPath.split('.')
    const schema = schemas.get(cubeName)

    if (!schema) {
      throw new SQLGenerationError(`Unknown cube: ${cubeName}`)
    }

    const dimension = schema.dimensions[dimName]
    if (!dimension) {
      throw new SQLGenerationError(`Unknown dimension: ${dimPath}`)
    }

    const alias = cubeName.toLowerCase()
    const sql = resolveSqlExpression(dimension.sql, alias, schema, schemas)

    parts.select.push(`${sql} AS "${dimPath}"`)
    parts.groupBy.push(sql)
  }
}

/**
 * Process time dimensions
 */
function processTimeDimensions(
  parts: SQLParts,
  timeDimensions: TimeDimension[],
  schemas: Map<string, CubeSchema>
): void {
  for (const timeDim of timeDimensions) {
    const [cubeName, dimName] = timeDim.dimension.split('.')
    const schema = schemas.get(cubeName)

    if (!schema) {
      throw new SQLGenerationError(`Unknown cube: ${cubeName}`)
    }

    const dimension = schema.dimensions[dimName]
    if (!dimension) {
      throw new SQLGenerationError(`Unknown time dimension: ${timeDim.dimension}`)
    }

    const alias = cubeName.toLowerCase()
    const baseSql = resolveSqlExpression(dimension.sql, alias, schema, schemas)

    // Add time dimension to SELECT
    if (timeDim.granularity) {
      const truncatedSql = truncateToGranularity(baseSql, timeDim.granularity)
      const selectAlias = `${timeDim.dimension}.${timeDim.granularity}`
      parts.select.push(`${truncatedSql} AS "${selectAlias}"`)
      parts.groupBy.push(truncatedSql)
    }

    // Add date range filter
    if (timeDim.dateRange) {
      const dateFilter = buildDateRangeFilter(baseSql, timeDim.dateRange)
      parts.where.push(dateFilter)
    }
  }
}

/**
 * Truncate time to granularity
 */
function truncateToGranularity(sql: string, granularity: Granularity): string {
  switch (granularity) {
    case 'year':
      return `DATE_TRUNC('year', ${sql})`
    case 'quarter':
      return `DATE_TRUNC('quarter', ${sql})`
    case 'month':
      return `DATE_TRUNC('month', ${sql})`
    case 'week':
      return `DATE_TRUNC('week', ${sql})`
    case 'day':
      return `DATE_TRUNC('day', ${sql})`
    case 'hour':
      return `DATE_TRUNC('hour', ${sql})`
    case 'minute':
      return `DATE_TRUNC('minute', ${sql})`
    case 'second':
      return `DATE_TRUNC('second', ${sql})`
    default:
      return sql
  }
}

/**
 * Build date range filter
 */
function buildDateRangeFilter(sql: string, dateRange: string | [string, string]): string {
  if (typeof dateRange === 'string') {
    // Relative date range
    return buildRelativeDateFilter(sql, dateRange)
  }

  const [start, end] = dateRange
  return `${sql} >= '${start}' AND ${sql} <= '${end}'`
}

/**
 * Build relative date filter
 */
function buildRelativeDateFilter(sql: string, rangeStr: string): string {
  // Parse relative date strings like "last 7 days", "this month", etc.
  const match = rangeStr.match(/last\s+(\d+)\s+(day|week|month|year)s?/i)

  if (match) {
    const amount = parseInt(match[1], 10)
    const unit = match[2].toLowerCase()
    return `${sql} >= NOW() - INTERVAL '${amount} ${unit}' AND ${sql} <= NOW()`
  }

  if (rangeStr.toLowerCase() === 'today') {
    return `DATE(${sql}) = CURRENT_DATE`
  }

  if (rangeStr.toLowerCase() === 'yesterday') {
    return `DATE(${sql}) = CURRENT_DATE - INTERVAL '1 day'`
  }

  if (rangeStr.toLowerCase() === 'this week') {
    return `${sql} >= DATE_TRUNC('week', NOW()) AND ${sql} <= NOW()`
  }

  if (rangeStr.toLowerCase() === 'this month') {
    return `${sql} >= DATE_TRUNC('month', NOW()) AND ${sql} <= NOW()`
  }

  if (rangeStr.toLowerCase() === 'this year') {
    return `${sql} >= DATE_TRUNC('year', NOW()) AND ${sql} <= NOW()`
  }

  // Default fallback
  return `${sql} >= NOW() - INTERVAL '30 day'`
}

/**
 * Process filters
 */
function processFilters(
  parts: SQLParts,
  filters: (Filter | LogicalFilter)[],
  schemas: Map<string, CubeSchema>
): void {
  for (const filter of filters) {
    const sql = buildFilterSql(filter, schemas)
    if (sql) {
      parts.where.push(sql)
    }
  }
}

/**
 * Build SQL for a filter
 */
function buildFilterSql(
  filter: Filter | LogicalFilter,
  schemas: Map<string, CubeSchema>
): string {
  // Logical filter
  if ('and' in filter && filter.and) {
    const conditions = filter.and
      .map((f) => buildFilterSql(f, schemas))
      .filter(Boolean)
    return conditions.length > 0 ? `(${conditions.join(' AND ')})` : ''
  }

  if ('or' in filter && filter.or) {
    const conditions = filter.or
      .map((f) => buildFilterSql(f, schemas))
      .filter(Boolean)
    return conditions.length > 0 ? `(${conditions.join(' OR ')})` : ''
  }

  // Member filter
  if ('member' in filter) {
    const [cubeName, memberName] = filter.member.split('.')
    const schema = schemas.get(cubeName)

    if (!schema) return ''

    const alias = cubeName.toLowerCase()
    let memberSql: string

    // Check if it's a measure or dimension
    if (schema.measures[memberName]) {
      memberSql = buildMeasureSql(schema.measures[memberName], alias, schema, schemas)
    } else if (schema.dimensions[memberName]) {
      memberSql = resolveSqlExpression(schema.dimensions[memberName].sql, alias, schema, schemas)
    } else {
      return ''
    }

    return buildOperatorSql(memberSql, filter.operator, filter.values)
  }

  return ''
}

/**
 * Build SQL for an operator
 */
function buildOperatorSql(
  sql: string,
  operator: string,
  values?: (string | number | boolean)[]
): string {
  switch (operator) {
    case 'equals':
      if (values?.length === 1) {
        return `${sql} = ${escapeSqlValue(values[0])}`
      }
      return `${sql} IN (${values?.map(escapeSqlValue).join(', ')})`

    case 'notEquals':
      if (values?.length === 1) {
        return `${sql} != ${escapeSqlValue(values[0])}`
      }
      return `${sql} NOT IN (${values?.map(escapeSqlValue).join(', ')})`

    case 'contains':
      return `${sql} LIKE ${escapeSqlValue(`%${values?.[0]}%`)}`

    case 'notContains':
      return `${sql} NOT LIKE ${escapeSqlValue(`%${values?.[0]}%`)}`

    case 'startsWith':
      return `${sql} LIKE ${escapeSqlValue(`${values?.[0]}%`)}`

    case 'endsWith':
      return `${sql} LIKE ${escapeSqlValue(`%${values?.[0]}`)}`

    case 'gt':
      return `${sql} > ${escapeSqlValue(values?.[0])}`

    case 'gte':
      return `${sql} >= ${escapeSqlValue(values?.[0])}`

    case 'lt':
      return `${sql} < ${escapeSqlValue(values?.[0])}`

    case 'lte':
      return `${sql} <= ${escapeSqlValue(values?.[0])}`

    case 'set':
      return `${sql} IS NOT NULL`

    case 'notSet':
      return `${sql} IS NULL`

    case 'inDateRange':
      if (values?.length === 2) {
        return `${sql} >= '${values[0]}' AND ${sql} <= '${values[1]}'`
      }
      return ''

    case 'notInDateRange':
      if (values?.length === 2) {
        return `(${sql} < '${values[0]}' OR ${sql} > '${values[1]}')`
      }
      return ''

    case 'beforeDate':
      return `${sql} < '${values?.[0]}'`

    case 'afterDate':
      return `${sql} > '${values?.[0]}'`

    default:
      return ''
  }
}

/**
 * Process ORDER BY
 */
function processOrder(
  parts: SQLParts,
  order: { [key: string]: 'asc' | 'desc' } | undefined,
  schemas: Map<string, CubeSchema>
): void {
  if (!order) return

  for (const [member, direction] of Object.entries(order)) {
    const [cubeName, memberName] = member.split('.')
    const schema = schemas.get(cubeName)

    if (!schema) continue

    const alias = cubeName.toLowerCase()
    let memberSql: string

    // Check if it's a measure or dimension
    if (schema.measures[memberName]) {
      memberSql = `"${member}"` // Use alias from SELECT
    } else if (schema.dimensions[memberName]) {
      memberSql = `"${member}"` // Use alias from SELECT
    } else {
      continue
    }

    parts.orderBy.push(`${memberSql} ${direction.toUpperCase()}`)
  }
}

/**
 * Build final SQL string
 */
function buildSQL(parts: SQLParts): string {
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

// =============================================================================
// Helpers
// =============================================================================

/**
 * Resolve SQL expression with substitutions (non-recursive version)
 */
function resolveSqlExpression(
  sql: string,
  tableAlias: string,
  cube: CubeSchema,
  _schemas: Map<string, CubeSchema>,
  depth: number = 0
): string {
  // Prevent infinite recursion
  if (depth > 10) {
    return sql
  }

  let resolved = sql

  // Replace ${CUBE} with table alias
  resolved = resolved.replace(/\$\{CUBE\}/g, tableAlias)

  // Replace dimension references only (not measures, to avoid recursion)
  for (const [name, dimension] of Object.entries(cube.dimensions)) {
    const regex = new RegExp(`\\$\\{${name}\\}`, 'g')
    const dimSql = resolveDimensionSql(dimension.sql, tableAlias)
    resolved = resolved.replace(regex, dimSql)
  }

  // Add table alias to bare column names (simple heuristic)
  if (
    !resolved.includes('.') &&
    !resolved.includes('(') &&
    !resolved.includes("'") &&
    !resolved.includes('*') &&
    !resolved.includes(' ')
  ) {
    resolved = `${tableAlias}.${resolved}`
  }

  return resolved
}

/**
 * Resolve dimension SQL with table alias
 */
function resolveDimensionSql(sql: string, tableAlias: string): string {
  // If it's a simple column name, add the table alias
  if (
    !sql.includes('.') &&
    !sql.includes('(') &&
    !sql.includes("'") &&
    !sql.includes('*') &&
    !sql.includes(' ')
  ) {
    return `${tableAlias}.${sql}`
  }

  // Replace ${CUBE} if present
  let resolved = sql.replace(/\$\{CUBE\}/g, tableAlias)

  return resolved
}

/**
 * Escape SQL value
 */
function escapeSqlValue(value: string | number | boolean | undefined): string {
  if (value === undefined || value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'

  // Escape single quotes
  const escaped = String(value).replace(/'/g, "''")
  return `'${escaped}'`
}

/**
 * Get all cubes referenced in a query
 */
function getQueryCubes(query: CubeQuery): Set<string> {
  const cubes = new Set<string>()

  const addCube = (member: string) => {
    const [cubeName] = member.split('.')
    if (cubeName) cubes.add(cubeName)
  }

  query.measures?.forEach(addCube)
  query.dimensions?.forEach(addCube)
  query.segments?.forEach(addCube)
  query.timeDimensions?.forEach((td) => addCube(td.dimension))

  // Extract from filters
  const extractFilterCubes = (filters: (Filter | LogicalFilter)[] | undefined) => {
    filters?.forEach((f) => {
      if ('member' in f) {
        addCube(f.member)
      }
      if ('and' in f && f.and) extractFilterCubes(f.and)
      if ('or' in f && f.or) extractFilterCubes(f.or)
    })
  }

  extractFilterCubes(query.filters)

  return cubes
}
