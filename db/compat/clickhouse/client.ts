/**
 * ClickHouse-compatible SQL Client
 *
 * Provides a ClickHouse-compatible interface for executing SQL queries
 * against in-memory MergeTree tables using the unified QueryEngine.
 *
 * Supports:
 * - CREATE TABLE with MergeTree engines
 * - INSERT INTO with VALUES
 * - SELECT with WHERE, GROUP BY, ORDER BY, LIMIT
 * - Aggregate functions
 * - WITH clause (CTEs)
 *
 * @see dotdo-b80fl - Unified Analytics Compat Layer Epic
 */

import { MergeTreeTable, type TableSchema, type ColumnDef, type MergeTreeEngine, type OrderByClause } from './tables'
import { ClickHouseEngine } from './engine'
import { SQLWhereParser, type ParsedSelect } from '../../primitives/query-engine/parsers/sql-parser'

// ============================================================================
// Types
// ============================================================================

/**
 * Client configuration
 */
export interface ClickHouseConfig {
  /** Connection mode */
  mode: 'memory' | 'remote'
  /** Host for remote mode */
  host?: string
  /** Port for remote mode */
  port?: number
  /** Database name */
  database?: string
  /** User for remote mode */
  user?: string
  /** Password for remote mode */
  password?: string
}

/**
 * Query result
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Whether the query succeeded */
  success: boolean
  /** Result rows for SELECT */
  rows: T[]
  /** Rows affected for INSERT/UPDATE/DELETE */
  rowsAffected?: number
  /** Execution statistics */
  statistics?: QueryStatistics
  /** Error message if failed */
  error?: string
}

/**
 * Query statistics
 */
export interface QueryStatistics {
  /** Rows read from storage */
  rowsRead: number
  /** Rows returned */
  rowsReturned: number
  /** Bytes read from storage */
  bytesRead: number
  /** Execution time in milliseconds */
  elapsedMs: number
  /** Peak memory usage */
  peakMemoryBytes?: number
}

/**
 * Parsed CREATE TABLE statement
 */
interface ParsedCreateTable {
  name: string
  columns: ColumnDef[]
  engine: MergeTreeEngine
  orderBy: string[]
  partitionBy?: string
  primaryKey?: string[]
  ttl?: string
  versionColumn?: string
}

/**
 * Parsed INSERT statement
 */
interface ParsedInsert {
  table: string
  columns?: string[]
  values: unknown[][]
}

// ============================================================================
// SQL Parser Extensions
// ============================================================================

/**
 * Parse CREATE TABLE statement
 */
function parseCreateTable(sql: string): ParsedCreateTable {
  const normalized = sql.replace(/\s+/g, ' ').trim()

  // Extract table name
  const nameMatch = normalized.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)
  if (!nameMatch) {
    throw new Error('Invalid CREATE TABLE: missing table name')
  }
  const name = nameMatch[1]

  // Extract columns
  const columnsMatch = normalized.match(/\(([\s\S]*?)\)\s*ENGINE/i)
  if (!columnsMatch) {
    throw new Error('Invalid CREATE TABLE: missing columns definition')
  }

  const columnsStr = columnsMatch[1]
  const columns: ColumnDef[] = []

  // Parse each column definition
  const columnDefs = columnsStr.split(',').map(s => s.trim())
  for (const colDef of columnDefs) {
    const parts = colDef.split(/\s+/)
    if (parts.length >= 2) {
      columns.push({
        name: parts[0],
        type: parts.slice(1).join(' '),
      })
    }
  }

  // Extract engine
  const engineMatch = normalized.match(/ENGINE\s*=\s*(\w+)/i)
  const engine = (engineMatch?.[1] || 'MergeTree') as MergeTreeEngine

  // Extract ORDER BY
  const orderByMatch = normalized.match(/ORDER\s+BY\s+\(([^)]+)\)|ORDER\s+BY\s+(\w+)/i)
  let orderBy: string[] = []
  if (orderByMatch) {
    const orderByStr = orderByMatch[1] || orderByMatch[2]
    orderBy = orderByStr.split(',').map(s => s.trim())
  }

  // Extract PARTITION BY
  const partitionMatch = normalized.match(/PARTITION\s+BY\s+([^(]+\([^)]+\)|[^\s,]+)/i)
  const partitionBy = partitionMatch?.[1]

  // Extract PRIMARY KEY
  const primaryKeyMatch = normalized.match(/PRIMARY\s+KEY\s+\(([^)]+)\)|PRIMARY\s+KEY\s+(\w+)/i)
  let primaryKey: string[] | undefined
  if (primaryKeyMatch) {
    const pkStr = primaryKeyMatch[1] || primaryKeyMatch[2]
    primaryKey = pkStr.split(',').map(s => s.trim())
  }

  // Extract TTL
  const ttlMatch = normalized.match(/TTL\s+(.+?)(?:SETTINGS|$)/i)
  const ttl = ttlMatch?.[1]?.trim()

  return {
    name,
    columns,
    engine,
    orderBy,
    partitionBy,
    primaryKey,
    ttl,
  }
}

/**
 * Parse INSERT statement
 */
function parseInsert(sql: string): ParsedInsert {
  const normalized = sql.replace(/\s+/g, ' ').trim()

  // Extract table name
  const tableMatch = normalized.match(/INSERT\s+INTO\s+(\w+)/i)
  if (!tableMatch) {
    throw new Error('Invalid INSERT: missing table name')
  }
  const table = tableMatch[1]

  // Check for column list
  let columns: string[] | undefined
  const colsMatch = normalized.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)\s+VALUES/i)
  if (colsMatch) {
    columns = colsMatch[1].split(',').map(s => s.trim())
  }

  // Extract VALUES
  const valuesMatch = normalized.match(/VALUES\s*([\s\S]+)$/i)
  if (!valuesMatch) {
    throw new Error('Invalid INSERT: missing VALUES')
  }

  const valuesStr = valuesMatch[1]
  const values: unknown[][] = []

  // Parse each row of values
  const rowMatches = valuesStr.matchAll(/\(([^)]+)\)/g)
  for (const match of rowMatches) {
    const rowStr = match[1]
    const rowValues: unknown[] = []

    // Parse individual values - handle strings and non-strings separately
    let i = 0
    while (i < rowStr.length) {
      // Skip whitespace and commas
      while (i < rowStr.length && (rowStr[i] === ' ' || rowStr[i] === ',' || rowStr[i] === '\t')) {
        i++
      }
      if (i >= rowStr.length) break

      const char = rowStr[i]

      if (char === "'" || char === '"') {
        // String literal
        const quote = char
        i++ // Skip opening quote
        let strValue = ''
        while (i < rowStr.length) {
          if (rowStr[i] === quote) {
            if (rowStr[i + 1] === quote) {
              // Escaped quote
              strValue += quote
              i += 2
            } else {
              // End of string
              i++ // Skip closing quote
              break
            }
          } else {
            strValue += rowStr[i]
            i++
          }
        }
        rowValues.push(strValue)
      } else {
        // Non-string value (number, null, boolean, etc.)
        let value = ''
        while (i < rowStr.length && rowStr[i] !== ',') {
          value += rowStr[i]
          i++
        }
        const trimmed = value.trim()
        if (trimmed) {
          rowValues.push(parseValue(trimmed))
        }
      }
    }

    values.push(rowValues)
  }

  return { table, columns, values }
}

/**
 * Parse a SQL value literal
 */
function parseValue(str: string): unknown {
  // NULL
  if (str.toUpperCase() === 'NULL') return null

  // Boolean
  if (str.toUpperCase() === 'TRUE') return true
  if (str.toUpperCase() === 'FALSE') return false

  // Number
  if (/^-?\d+\.?\d*$/.test(str)) {
    return str.includes('.') ? parseFloat(str) : parseInt(str, 10)
  }

  // String (already stripped of quotes by parser)
  return str
}

/**
 * Convert ParsedSelect WHERE to table filter format
 */
function convertWhereToFilter(where: unknown): Record<string, unknown> | undefined {
  if (!where) return undefined

  const whereNode = where as { type: string; column?: string; op?: string; value?: unknown; op?: string; children?: unknown[] }

  if (whereNode.type === 'predicate') {
    const { column, op, value } = whereNode
    if (!column) return undefined

    switch (op) {
      case '=':
        return { [column]: value }
      case '!=':
      case '<>':
        return { [column]: { $ne: value } }
      case '>':
        return { [column]: { $gt: value } }
      case '>=':
        return { [column]: { $gte: value } }
      case '<':
        return { [column]: { $lt: value } }
      case '<=':
        return { [column]: { $lte: value } }
      case 'IN':
        return { [column]: { $in: value } }
      case 'NOT IN':
        return { [column]: { $notIn: value } }
      case 'LIKE':
        return { [column]: { $like: value } }
      case 'IS NULL':
        return { [column]: { $isNull: true } }
      case 'IS NOT NULL':
        return { [column]: { $isNull: false } }
      default:
        return { [column]: value }
    }
  }

  if (whereNode.type === 'logical') {
    const children = (whereNode.children || []).map(c => convertWhereToFilter(c)).filter(Boolean)

    if (whereNode.op === 'AND') {
      return { $and: children }
    }
    if (whereNode.op === 'OR') {
      return { $or: children }
    }
    if (whereNode.op === 'NOT' && children.length > 0) {
      return { $not: children[0] }
    }
  }

  return undefined
}

// ============================================================================
// ClickHouseClient
// ============================================================================

/**
 * ClickHouse-compatible client
 */
export class ClickHouseClient {
  private config: ClickHouseConfig
  private tables: Map<string, MergeTreeTable<any>> = new Map()
  private engine: ClickHouseEngine
  private sqlParser: SQLWhereParser

  constructor(config: ClickHouseConfig) {
    this.config = config
    this.engine = new ClickHouseEngine()
    this.sqlParser = new SQLWhereParser()
  }

  /**
   * Execute a SQL query
   */
  async query<T = Record<string, unknown>>(sql: string): Promise<QueryResult<T>> {
    const startTime = performance.now()
    const normalized = sql.trim()

    try {
      // Detect query type
      const upperSql = normalized.toUpperCase()

      if (upperSql.startsWith('CREATE TABLE')) {
        return this.executeCreateTable(normalized) as QueryResult<T>
      }

      if (upperSql.startsWith('INSERT INTO')) {
        return this.executeInsert(normalized) as QueryResult<T>
      }

      if (upperSql.startsWith('SELECT') || upperSql.startsWith('WITH')) {
        return this.executeSelect<T>(normalized, startTime)
      }

      if (upperSql.startsWith('DROP TABLE')) {
        return this.executeDropTable(normalized) as QueryResult<T>
      }

      if (upperSql.startsWith('TRUNCATE')) {
        return this.executeTruncate(normalized) as QueryResult<T>
      }

      throw new Error(`Unsupported SQL statement: ${normalized.substring(0, 50)}...`)
    } catch (error) {
      return {
        success: false,
        rows: [],
        error: (error as Error).message,
        statistics: {
          rowsRead: 0,
          rowsReturned: 0,
          bytesRead: 0,
          elapsedMs: performance.now() - startTime,
        },
      }
    }
  }

  /**
   * Execute CREATE TABLE
   */
  private executeCreateTable(sql: string): QueryResult {
    const parsed = parseCreateTable(sql)

    // Check if table exists
    if (this.tables.has(parsed.name)) {
      // Handle IF NOT EXISTS
      if (sql.toUpperCase().includes('IF NOT EXISTS')) {
        return { success: true, rows: [] }
      }
      throw new Error(`Table ${parsed.name} already exists`)
    }

    // Create table
    const table = new MergeTreeTable({
      name: parsed.name,
      engine: parsed.engine,
      columns: parsed.columns,
      orderBy: parsed.orderBy as any,
      partitionBy: parsed.partitionBy,
      primaryKey: parsed.primaryKey as any,
      ttl: parsed.ttl,
    })

    this.tables.set(parsed.name, table)

    return { success: true, rows: [] }
  }

  /**
   * Execute INSERT INTO
   */
  private executeInsert(sql: string): QueryResult {
    const parsed = parseInsert(sql)

    // Get table
    const table = this.tables.get(parsed.table)
    if (!table) {
      throw new Error(`Table ${parsed.table} not found`)
    }

    // Build rows
    const columnNames = parsed.columns || table.columns.map(c => c.name)
    const rows: Record<string, unknown>[] = []

    for (const valueRow of parsed.values) {
      const row: Record<string, unknown> = {}

      for (let i = 0; i < columnNames.length; i++) {
        const colName = columnNames[i]
        const value = valueRow[i]

        // Type validation
        const colDef = table.columns.find(c => c.name === colName)
        if (colDef) {
          const normalizedType = colDef.type.replace(/\(.*\)/, '').toUpperCase()
          if (normalizedType.includes('INT') || normalizedType.includes('FLOAT')) {
            if (typeof value === 'string' && isNaN(Number(value))) {
              throw new Error(`Type mismatch: cannot insert '${value}' into ${colDef.type} column ${colName}`)
            }
          }
        }

        row[colName] = value
      }

      rows.push(row)
    }

    // Insert rows
    table.insertBatch(rows as any)

    return {
      success: true,
      rows: [],
      rowsAffected: rows.length,
    }
  }

  /**
   * Execute SELECT query
   */
  private executeSelect<T>(sql: string, startTime: number): QueryResult<T> {
    // Handle WITH clause (CTEs) - simplified implementation
    let mainQuery = sql
    const ctes = new Map<string, unknown[]>()

    if (sql.toUpperCase().startsWith('WITH')) {
      const withMatch = sql.match(/WITH\s+([\s\S]+?)\s+SELECT/i)
      if (withMatch) {
        // Extract CTE definition
        const cteMatch = withMatch[1].match(/(\w+)\s+AS\s*\(([\s\S]+)\)/i)
        if (cteMatch) {
          const cteName = cteMatch[1]
          const cteQuery = cteMatch[2]

          // Execute CTE query
          const cteResult = this.executeSelect<Record<string, unknown>>(cteQuery, startTime)
          ctes.set(cteName, cteResult.rows)
        }

        // Extract main query
        mainQuery = 'SELECT' + sql.substring(sql.toUpperCase().indexOf('SELECT') + 6)
      }
    }

    // Parse SELECT
    const parsed = this.sqlParser.parseSelect(mainQuery)

    // Get table
    let tableName = parsed.from
    if (!tableName) {
      throw new Error('SELECT requires FROM clause')
    }

    // Check if it's a CTE reference
    if (ctes.has(tableName)) {
      const cteRows = ctes.get(tableName)!
      return {
        success: true,
        rows: this.projectRows(cteRows, parsed) as T[],
        statistics: {
          rowsRead: cteRows.length,
          rowsReturned: cteRows.length,
          bytesRead: JSON.stringify(cteRows).length,
          elapsedMs: performance.now() - startTime,
        },
      }
    }

    const table = this.tables.get(tableName)
    if (!table) {
      throw new Error(`Table '${tableName}' not found`)
    }

    // Build select options
    const selectOptions: any = {}

    // WHERE
    if (parsed.where) {
      selectOptions.where = convertWhereToFilter(parsed.where)
    }

    // ORDER BY
    if (parsed.sort) {
      selectOptions.orderBy = parsed.sort.columns.map(c => ({
        column: c.column,
        direction: c.direction,
        nulls: c.nulls?.toUpperCase(),
      }))
    }

    // LIMIT/OFFSET
    if (parsed.limit !== undefined) {
      selectOptions.limit = parsed.limit
    }
    if (parsed.offset !== undefined) {
      selectOptions.offset = parsed.offset
    }

    // Check for aggregations
    const hasAggregation = this.hasAggregations(parsed)

    let rows: T[]
    let rowsRead = 0

    if (hasAggregation) {
      // Execute aggregate query
      const aggResult = this.executeAggregateSelect<T>(table, parsed)
      rows = aggResult.rows
      rowsRead = table.rowCount()
    } else {
      // Simple select
      const allRows = table.select(selectOptions)
      rowsRead = table.rowCount()
      rows = this.projectRows(allRows, parsed) as T[]
    }

    // Calculate bytes read (estimate)
    const bytesRead = rowsRead * table.columns.length * 8 // Rough estimate

    return {
      success: true,
      rows,
      statistics: {
        rowsRead,
        rowsReturned: rows.length,
        bytesRead,
        elapsedMs: performance.now() - startTime,
      },
    }
  }

  /**
   * Check if query has aggregations
   */
  private hasAggregations(parsed: ParsedSelect): boolean {
    if (parsed.groupBy) return true

    const projection = parsed.projection
    if (!projection?.columns) return false

    for (const col of projection.columns) {
      const source = typeof col === 'string' ? col : col.source
      if (/^(COUNT|SUM|AVG|MIN|MAX|UNIQ)/i.test(source)) {
        return true
      }
    }

    return false
  }

  /**
   * Execute aggregate SELECT
   */
  private executeAggregateSelect<T>(table: MergeTreeTable<any>, parsed: ParsedSelect): { rows: T[] } {
    const groupBy = parsed.groupBy?.columns || []
    const projection = parsed.projection?.columns || []

    // Build aggregation spec and track aliases
    const aggregations: Record<string, unknown> = {}
    const aliasMap: Record<string, string> = {} // spec key -> alias

    for (const col of projection) {
      const source = typeof col === 'string' ? col : col.source
      const alias = typeof col === 'string' ? col : (col.alias || col.source)

      // Parse aggregate function
      const aggMatch = source.match(/^(COUNT|SUM|AVG|MIN|MAX|UNIQ)\s*\(\s*(\*|\w+)\s*\)/i)
      if (aggMatch) {
        const fn = aggMatch[1].toLowerCase()
        const arg = aggMatch[2]

        // Store in standard spec format
        if (fn === 'count') {
          aggregations.count = arg === '*' ? '*' : arg
          aliasMap.count = alias
        } else if (fn === 'sum') {
          aggregations.sum = arg
          aliasMap.sum = alias
        } else if (fn === 'avg') {
          aggregations.avg = arg
          aliasMap.avg = alias
        } else if (fn === 'min') {
          aggregations.min = arg
          aliasMap.min = alias
        } else if (fn === 'max') {
          aggregations.max = arg
          aliasMap.max = alias
        } else if (fn === 'uniq') {
          aggregations.uniq = arg
          aliasMap.uniq = alias
        }
      }
    }

    // Use table's groupBy method
    if (groupBy.length > 0) {
      // Get raw results without ordering (we'll apply order after alias renaming)
      const rawResult = table.groupBy(groupBy, aggregations as any, {
        // Don't pass orderBy here - we need to apply it after alias renaming
        limit: undefined, // Don't limit yet either
      })

      // Rename aggregate columns to use aliases
      let result = rawResult.map(row => {
        const newRow: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(row)) {
          const alias = aliasMap[key]
          if (alias) {
            newRow[alias] = value
          } else {
            newRow[key] = value
          }
        }
        return newRow
      })

      // Apply ORDER BY after alias renaming
      if (parsed.sort?.columns && parsed.sort.columns.length > 0) {
        result.sort((a, b) => {
          for (const clause of parsed.sort!.columns) {
            const aVal = a[clause.column]
            const bVal = b[clause.column]
            let cmp = 0
            if (typeof aVal === 'number' && typeof bVal === 'number') {
              cmp = aVal - bVal
            } else {
              cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''))
            }
            if (cmp !== 0) {
              return clause.direction === 'DESC' ? -cmp : cmp
            }
          }
          return 0
        })
      }

      // Apply LIMIT after ordering
      if (parsed.limit !== undefined) {
        result = result.slice(0, parsed.limit)
      }

      return { rows: result as T[] }
    }

    // Simple aggregation (no GROUP BY)
    const rawResult = table.aggregate(aggregations as any)

    // Rename to use aliases
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(rawResult)) {
      const alias = aliasMap[key]
      if (alias) {
        result[alias] = value
      } else {
        result[key] = value
      }
    }

    return { rows: [result] as T[] }
  }

  /**
   * Project rows to match SELECT columns
   */
  private projectRows(rows: unknown[], parsed: ParsedSelect): unknown[] {
    const projection = parsed.projection
    if (!projection?.columns) return rows

    // Check for SELECT *
    const hasWildcard = projection.columns.some(c =>
      (typeof c === 'string' && c === '*') || (typeof c === 'object' && c.source === '*')
    )
    if (hasWildcard) return rows

    return rows.map(row => {
      const projected: Record<string, unknown> = {}
      const rowObj = row as Record<string, unknown>

      for (const col of projection.columns) {
        const source = typeof col === 'string' ? col : col.source
        const alias = typeof col === 'string' ? col : (col.alias || col.source)

        projected[alias] = rowObj[source]
      }

      return projected
    })
  }

  /**
   * Execute DROP TABLE
   */
  private executeDropTable(sql: string): QueryResult {
    const match = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i)
    if (!match) {
      throw new Error('Invalid DROP TABLE syntax')
    }

    const tableName = match[1]
    const existed = this.tables.delete(tableName)

    if (!existed && !sql.toUpperCase().includes('IF EXISTS')) {
      throw new Error(`Table ${tableName} not found`)
    }

    return { success: true, rows: [] }
  }

  /**
   * Execute TRUNCATE
   */
  private executeTruncate(sql: string): QueryResult {
    const match = sql.match(/TRUNCATE\s+(?:TABLE\s+)?(\w+)/i)
    if (!match) {
      throw new Error('Invalid TRUNCATE syntax')
    }

    const tableName = match[1]
    const table = this.tables.get(tableName)

    if (!table) {
      throw new Error(`Table ${tableName} not found`)
    }

    // Recreate empty table
    this.tables.set(tableName, new MergeTreeTable({
      name: table.name,
      engine: table.engine,
      columns: table.columns,
      orderBy: table.orderBy as any,
      partitionBy: table.partitionBy,
      primaryKey: table.primaryKey as any,
      ttl: table.ttl,
    }))

    return { success: true, rows: [] }
  }

  /**
   * Get a table by name
   */
  getTable(name: string): MergeTreeTable<any> | undefined {
    return this.tables.get(name)
  }

  /**
   * List all tables
   */
  listTables(): string[] {
    return [...this.tables.keys()]
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    this.tables.clear()
  }
}
