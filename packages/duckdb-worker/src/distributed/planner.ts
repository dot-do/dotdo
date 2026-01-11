/**
 * Query Planner for Distributed Query Layer
 *
 * The planner is responsible for:
 * 1. Parsing SQL queries to extract structure
 * 2. Determining partition pruning based on WHERE filters
 * 3. Planning pushdown operations for data workers
 * 4. Estimating query costs
 *
 * @module packages/duckdb-worker/src/distributed/planner
 */

import type {
  DistributedQueryConfig,
  PartitionInfo,
  QueryPlan,
  PushdownOps,
  FilterPredicate,
  AggregateExpr,
  AggregateFunction,
  SortSpec,
} from './types.js'

// ============================================================================
// SQL Parsing Types
// ============================================================================

interface ParsedQuery {
  table: string
  projection: string[]
  filters: FilterPredicate[]
  groupBy: string[]
  aggregates: AggregateExpr[]
  orderBy: SortSpec[]
  limit?: number
  distinct: boolean
}

// ============================================================================
// Query Planner Implementation
// ============================================================================

/**
 * Query Planner for distributed query execution
 *
 * Parses SQL queries and generates execution plans with partition pruning
 * and pushdown optimizations.
 */
export class QueryPlanner {
  private readonly config: DistributedQueryConfig

  constructor(config: DistributedQueryConfig) {
    this.config = config
  }

  /**
   * Generate a query plan from SQL and available partitions
   */
  plan(sql: string, partitions: PartitionInfo[]): QueryPlan {
    // Parse the SQL query
    const parsed = this.parseSQL(sql)

    // Apply partition pruning
    const { selected, pruned } = this.prunePartitions(partitions, parsed.filters)

    // Build pushdown operations
    const pushdownOps: PushdownOps = {
      filters: parsed.filters,
      groupBy: parsed.groupBy,
      aggregates: parsed.aggregates,
      projection: parsed.projection,
      orderBy: parsed.orderBy.length > 0 ? parsed.orderBy : undefined,
      limit: parsed.limit,
    }

    // Determine if global sort is required
    const requiresGlobalSort = parsed.orderBy.length > 0

    // Determine if this is a top-N query
    const isTopN = requiresGlobalSort && parsed.limit !== undefined

    // Calculate estimates
    const estimatedRows = selected.reduce((sum, p) => sum + p.rowCount, 0)
    const estimatedBytes = selected.reduce((sum, p) => sum + p.sizeBytes, 0)

    return {
      originalSql: sql,
      table: parsed.table,
      partitions: selected,
      prunedPartitions: pruned,
      pushdownOps,
      requiresGlobalSort,
      isTopN,
      estimatedRows,
      estimatedBytes,
    }
  }

  /**
   * Parse SQL query to extract structure
   *
   * This is a simplified SQL parser that handles common analytical queries.
   * For production use, consider using a proper SQL parser library.
   */
  private parseSQL(sql: string): ParsedQuery {
    const normalizedSql = sql.trim().replace(/\s+/g, ' ')

    // Extract table name from FROM clause
    const table = this.extractTable(normalizedSql)

    // Extract SELECT projection
    const { projection, aggregates } = this.extractProjection(normalizedSql)

    // Extract WHERE filters
    const filters = this.extractFilters(normalizedSql)

    // Extract GROUP BY
    const groupBy = this.extractGroupBy(normalizedSql)

    // Extract ORDER BY
    const orderBy = this.extractOrderBy(normalizedSql)

    // Extract LIMIT
    const limit = this.extractLimit(normalizedSql)

    // Check for DISTINCT
    const distinct = /SELECT\s+DISTINCT\s/i.test(normalizedSql)

    return {
      table,
      projection,
      filters,
      groupBy,
      aggregates,
      orderBy,
      limit,
      distinct,
    }
  }

  /**
   * Extract table name from FROM clause
   */
  private extractTable(sql: string): string {
    const match = sql.match(/FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i)
    if (!match) {
      throw new Error('Could not extract table name from query')
    }
    return match[1]
  }

  /**
   * Extract projection columns and aggregate expressions
   */
  private extractProjection(sql: string): { projection: string[]; aggregates: AggregateExpr[] } {
    // Get content between SELECT and FROM
    const selectMatch = sql.match(/SELECT\s+(?:DISTINCT\s+)?(.*?)\s+FROM/is)
    if (!selectMatch) {
      return { projection: ['*'], aggregates: [] }
    }

    const selectClause = selectMatch[1]
    const projection: string[] = []
    const aggregates: AggregateExpr[] = []

    // Split by comma, handling parentheses
    const items = this.splitSelectItems(selectClause)

    for (const item of items) {
      const trimmedItem = item.trim()

      // Check for aggregate functions
      const aggMatch = trimmedItem.match(
        /^(SUM|COUNT|AVG|MIN|MAX)\s*\(\s*(\*|DISTINCT\s+)?([a-zA-Z_][a-zA-Z0-9_]*)?\s*\)\s*(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)?$/i
      )

      if (aggMatch) {
        const fn = aggMatch[1].toUpperCase() as AggregateFunction
        const hasDistinct = aggMatch[2]?.includes('DISTINCT')
        const column = aggMatch[3] || null
        const alias = aggMatch[4] || `${fn.toLowerCase()}_${column || 'all'}`

        aggregates.push({
          fn,
          column,
          alias,
          distinct: hasDistinct,
        })
      } else {
        // Regular column or expression
        const aliasMatch = trimmedItem.match(/^(.*?)\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)$/i)
        if (aliasMatch) {
          projection.push(aliasMatch[1].trim())
        } else {
          projection.push(trimmedItem)
        }
      }
    }

    return { projection, aggregates }
  }

  /**
   * Split SELECT items by comma, respecting parentheses
   */
  private splitSelectItems(selectClause: string): string[] {
    const items: string[] = []
    let current = ''
    let depth = 0

    for (const char of selectClause) {
      if (char === '(') {
        depth++
        current += char
      } else if (char === ')') {
        depth--
        current += char
      } else if (char === ',' && depth === 0) {
        items.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }

    if (current.trim()) {
      items.push(current.trim())
    }

    return items
  }

  /**
   * Extract WHERE clause filters
   */
  private extractFilters(sql: string): FilterPredicate[] {
    const filters: FilterPredicate[] = []

    // Extract WHERE clause
    const whereMatch = sql.match(/WHERE\s+(.*?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|\s*$)/is)
    if (!whereMatch) {
      return filters
    }

    const whereClause = whereMatch[1]

    // Split by AND carefully - don't split BETWEEN X AND Y
    const conditions = this.splitWhereConditions(whereClause)

    for (const condition of conditions) {
      const filter = this.parseCondition(condition.trim())
      if (filter) {
        filters.push(filter)
      }
    }

    return filters
  }

  /**
   * Split WHERE conditions by AND, preserving BETWEEN X AND Y
   */
  private splitWhereConditions(whereClause: string): string[] {
    const conditions: string[] = []
    let current = ''
    let inBetween = false

    // Tokenize by spaces while preserving quoted strings
    const tokens = whereClause.match(/('[^']*'|\S+)/g) || []

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const upperToken = token.toUpperCase()

      if (upperToken === 'BETWEEN') {
        inBetween = true
        current += (current ? ' ' : '') + token
      } else if (upperToken === 'AND' && !inBetween) {
        // This AND is a condition separator
        if (current.trim()) {
          conditions.push(current.trim())
        }
        current = ''
      } else if (upperToken === 'AND' && inBetween) {
        // This AND is part of BETWEEN X AND Y
        current += ' ' + token
        inBetween = false // Reset after BETWEEN's AND
      } else {
        current += (current ? ' ' : '') + token
      }
    }

    if (current.trim()) {
      conditions.push(current.trim())
    }

    return conditions
  }

  /**
   * Parse a single WHERE condition
   */
  private parseCondition(condition: string): FilterPredicate | null {
    // BETWEEN (handles both quoted and unquoted values)
    const betweenMatch = condition.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s+BETWEEN\s+'?([^']+?)'?\s+AND\s+'?([^']+?)'?$/i
    )
    if (betweenMatch) {
      return {
        column: betweenMatch[1],
        op: 'BETWEEN',
        value: betweenMatch[2],
        value2: betweenMatch[3],
      }
    }

    // IN clause
    const inMatch = condition.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s+(NOT\s+)?IN\s*\(([^)]+)\)$/i
    )
    if (inMatch) {
      const values = inMatch[3]
        .split(',')
        .map((v) => v.trim().replace(/^'|'$/g, ''))
      return {
        column: inMatch[1],
        op: inMatch[2] ? 'NOT IN' : 'IN',
        value: values,
      }
    }

    // IS NULL / IS NOT NULL
    const nullMatch = condition.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s+(IS\s+NOT\s+NULL|IS\s+NULL)$/i
    )
    if (nullMatch) {
      return {
        column: nullMatch[1],
        op: nullMatch[2].toUpperCase().includes('NOT') ? 'IS NOT NULL' : 'IS NULL',
        value: null,
      }
    }

    // LIKE
    const likeMatch = condition.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s+LIKE\s+'([^']+)'$/i
    )
    if (likeMatch) {
      return {
        column: likeMatch[1],
        op: 'LIKE',
        value: likeMatch[2],
      }
    }

    // Comparison operators
    const compMatch = condition.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(>=|<=|!=|<>|>|<|=)\s*'?([^']*?)'?$/i
    )
    if (compMatch) {
      let op = compMatch[2] as FilterPredicate['op']
      if (op === '<>') op = '!='

      let value: unknown = compMatch[3]
      // Try to parse as number
      const numValue = parseFloat(value as string)
      if (!isNaN(numValue) && String(numValue) === value) {
        value = numValue
      }

      return {
        column: compMatch[1],
        op,
        value,
      }
    }

    return null
  }

  /**
   * Extract GROUP BY columns
   */
  private extractGroupBy(sql: string): string[] {
    const match = sql.match(/GROUP\s+BY\s+(.*?)(?:\s+HAVING|\s+ORDER\s+BY|\s+LIMIT|\s*$)/i)
    if (!match) {
      return []
    }

    return match[1].split(',').map((col) => col.trim())
  }

  /**
   * Extract ORDER BY specification
   */
  private extractOrderBy(sql: string): SortSpec[] {
    const match = sql.match(/ORDER\s+BY\s+(.*?)(?:\s+LIMIT|\s*$)/i)
    if (!match) {
      return []
    }

    const orderClause = match[1]
    const specs: SortSpec[] = []

    const items = orderClause.split(',')
    for (const item of items) {
      const trimmed = item.trim()
      const parts = trimmed.split(/\s+/)
      const column = parts[0]
      const direction = (parts[1]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC') as 'ASC' | 'DESC'

      // Check for NULLS FIRST/LAST
      let nulls: 'FIRST' | 'LAST' | undefined
      if (trimmed.toUpperCase().includes('NULLS FIRST')) {
        nulls = 'FIRST'
      } else if (trimmed.toUpperCase().includes('NULLS LAST')) {
        nulls = 'LAST'
      }

      specs.push({ column, direction, nulls })
    }

    return specs
  }

  /**
   * Extract LIMIT value
   */
  private extractLimit(sql: string): number | undefined {
    const match = sql.match(/LIMIT\s+(\d+)/i)
    if (!match) {
      return undefined
    }
    return parseInt(match[1], 10)
  }

  /**
   * Prune partitions based on filters
   */
  private prunePartitions(
    partitions: PartitionInfo[],
    filters: FilterPredicate[]
  ): { selected: PartitionInfo[]; pruned: number } {
    let selected = [...partitions]

    for (const filter of filters) {
      selected = selected.filter((partition) => {
        // Check if filter column is a partition column
        if (!(filter.column in partition.partitionValues)) {
          // Not a partition column, can't prune
          return true
        }

        const partitionValue = partition.partitionValues[filter.column]

        switch (filter.op) {
          case '=':
            return partitionValue === filter.value

          case '!=':
            return partitionValue !== filter.value

          case '>':
            return partitionValue! > (filter.value as string | number)

          case '>=':
            return partitionValue! >= (filter.value as string | number)

          case '<':
            return partitionValue! < (filter.value as string | number)

          case '<=':
            return partitionValue! <= (filter.value as string | number)

          case 'IN':
            return (filter.value as unknown[]).includes(partitionValue)

          case 'NOT IN':
            return !(filter.value as unknown[]).includes(partitionValue)

          case 'BETWEEN':
            return (
              partitionValue! >= (filter.value as string | number) &&
              partitionValue! <= (filter.value2 as string | number)
            )

          case 'IS NULL':
            return partitionValue === null

          case 'IS NOT NULL':
            return partitionValue !== null

          default:
            // Unknown operator, don't prune
            return true
        }
      })
    }

    const pruned = partitions.length - selected.length
    return { selected, pruned }
  }

  /**
   * Generate partial SQL for a data worker
   *
   * This generates SQL that will be executed on each partition
   * with appropriate pushdowns applied.
   */
  generatePartitionSQL(plan: QueryPlan, tableName: string = 'partition_data'): string {
    const { pushdownOps } = plan

    // Build SELECT clause
    let selectItems: string[] = []

    // Add group by columns
    for (const col of pushdownOps.groupBy) {
      selectItems.push(col)
    }

    // Add aggregates
    for (const agg of pushdownOps.aggregates) {
      const distinct = agg.distinct ? 'DISTINCT ' : ''
      const col = agg.column || '*'
      selectItems.push(`${agg.fn}(${distinct}${col}) as ${agg.alias}`)

      // For AVG, we also need COUNT for proper merging
      if (agg.fn === 'AVG') {
        selectItems.push(`COUNT(${agg.column}) as ${agg.alias}_count`)
      }
    }

    // If no aggregates or group by, use projection
    if (selectItems.length === 0) {
      selectItems = pushdownOps.projection.length > 0 ? pushdownOps.projection : ['*']
    }

    let sql = `SELECT ${selectItems.join(', ')} FROM ${tableName}`

    // Add WHERE clause
    if (pushdownOps.filters.length > 0) {
      const whereClauses = pushdownOps.filters.map((f) => this.filterToSQL(f))
      sql += ` WHERE ${whereClauses.join(' AND ')}`
    }

    // Add GROUP BY
    if (pushdownOps.groupBy.length > 0) {
      sql += ` GROUP BY ${pushdownOps.groupBy.join(', ')}`
    }

    // For top-N queries, add ORDER BY and LIMIT to reduce data transfer
    if (plan.isTopN && pushdownOps.orderBy) {
      const orderClauses = pushdownOps.orderBy.map((o) => {
        let clause = o.column
        if (o.direction) clause += ` ${o.direction}`
        if (o.nulls) clause += ` NULLS ${o.nulls}`
        return clause
      })
      sql += ` ORDER BY ${orderClauses.join(', ')}`

      // For top-N, each partition returns limit * 2 to ensure correct merging
      if (pushdownOps.limit) {
        sql += ` LIMIT ${pushdownOps.limit * 2}`
      }
    }

    return sql
  }

  /**
   * Convert a filter predicate to SQL
   */
  private filterToSQL(filter: FilterPredicate): string {
    const { column, op, value, value2 } = filter

    switch (op) {
      case 'IN':
        const inValues = (value as unknown[]).map((v) => this.valueToSQL(v)).join(', ')
        return `${column} IN (${inValues})`

      case 'NOT IN':
        const notInValues = (value as unknown[]).map((v) => this.valueToSQL(v)).join(', ')
        return `${column} NOT IN (${notInValues})`

      case 'BETWEEN':
        return `${column} BETWEEN ${this.valueToSQL(value)} AND ${this.valueToSQL(value2)}`

      case 'IS NULL':
        return `${column} IS NULL`

      case 'IS NOT NULL':
        return `${column} IS NOT NULL`

      case 'LIKE':
        return `${column} LIKE ${this.valueToSQL(value)}`

      default:
        return `${column} ${op} ${this.valueToSQL(value)}`
    }
  }

  /**
   * Convert a value to SQL literal
   */
  private valueToSQL(value: unknown): string {
    if (value === null) {
      return 'NULL'
    }
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`
    }
    if (typeof value === 'number') {
      return String(value)
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE'
    }
    return String(value)
  }
}
