/**
 * ClickHouse-Grade Analytics Engine
 *
 * Columnar storage engine with aggregations, time series functions,
 * materialized views, and ClickHouse-compatible SQL interface.
 *
 * Designed for Cloudflare Workers with DO persistence.
 */

import type {
  TableSchema,
  ResolvedTableSchema,
  ColumnType,
  ColumnStore,
  QueryResult,
  MaterializedView,
  MaterializedViewConfig,
  SQLSelectStatement,
  SQLAggregation,
  SQLFunction,
  SQLExpression,
  SQLOrderBy,
  AggregationType,
} from './types'
import { AnalyticsError } from './types'
import { parseSQL } from './sql-parser'

// ============================================================================
// ANALYTICS ENGINE
// ============================================================================

export class AnalyticsEngine {
  private tables = new Map<string, ColumnarTable>()
  private materializedViews = new Map<string, MaterializedViewInternal>()

  // ============================================================================
  // TABLE MANAGEMENT
  // ============================================================================

  async createTable(name: string, schema: TableSchema): Promise<void> {
    if (this.tables.has(name)) {
      throw new AnalyticsError(`Table ${name} already exists`, 'TABLE_EXISTS')
    }

    const resolved = this.resolveSchema(schema)
    const table = new ColumnarTable(name, resolved)
    this.tables.set(name, table)
  }

  async dropTable(name: string): Promise<void> {
    if (!this.tables.has(name)) {
      throw new AnalyticsError(`Table ${name} does not exist`, 'TABLE_NOT_FOUND')
    }
    this.tables.delete(name)
  }

  listTables(): string[] {
    return Array.from(this.tables.keys())
  }

  getTableSchema(name: string): ResolvedTableSchema | undefined {
    return this.tables.get(name)?.schema
  }

  // ============================================================================
  // DATA INSERTION
  // ============================================================================

  async insert(tableName: string, rows: Record<string, unknown>[]): Promise<void> {
    const table = this.tables.get(tableName)
    if (!table) {
      throw new AnalyticsError(`Table ${tableName} does not exist`, 'TABLE_NOT_FOUND')
    }

    table.insert(rows)

    // Update materialized views
    for (const view of this.materializedViews.values()) {
      if (view.source === tableName) {
        await this.refreshMaterializedView(view.name, rows)
      }
    }
  }

  // ============================================================================
  // QUERY EXECUTION
  // ============================================================================

  async query<T = Record<string, unknown>>(sql: string): Promise<QueryResult<T>> {
    const startTime = performance.now()
    let ast: SQLSelectStatement

    try {
      ast = parseSQL(sql)
    } catch (e) {
      throw new AnalyticsError(
        `SQL syntax error: ${e instanceof Error ? e.message : 'Unknown error'}`,
        'SYNTAX_ERROR'
      )
    }

    const result = await this.executeQuery<T>(ast)
    result.executionTimeMs = performance.now() - startTime

    return result
  }

  private async executeQuery<T>(ast: SQLSelectStatement): Promise<QueryResult<T>> {
    // Get source table or subquery result
    let sourceRows: Record<string, unknown>[]
    let sourceSchema: ResolvedTableSchema
    let columnsScanned: string[] = []

    if (typeof ast.from === 'string') {
      // Handle virtual __dual__ table for function-only queries (like SELECT now())
      if (ast.from === '__dual__') {
        sourceRows = [{}] // Single empty row for function evaluation
        sourceSchema = { columns: {}, orderBy: [], primaryKey: [] }
      }
      // Check materialized views first
      else if (this.materializedViews.has(ast.from)) {
        const view = this.materializedViews.get(ast.from)!
        sourceRows = view.data
        sourceSchema = view.schema
      } else {
        const table = this.tables.get(ast.from)
        if (!table) {
          throw new AnalyticsError(`Table ${ast.from} does not exist`, 'TABLE_NOT_FOUND')
        }
        sourceRows = table.getRows()
        sourceSchema = table.schema
        columnsScanned = this.getRequiredColumns(ast, sourceSchema)
      }
    } else {
      // Subquery
      const subResult = await this.executeQuery<Record<string, unknown>>(ast.from)
      sourceRows = subResult.rows
      sourceSchema = {
        columns: subResult.columnTypes,
        orderBy: [],
        primaryKey: [],
      }
    }

    // Apply WHERE filter
    let filteredRows = sourceRows
    if (ast.where) {
      filteredRows = this.applyWhere(filteredRows, ast.where, sourceSchema)
    }

    // Apply GROUP BY and aggregations
    let resultRows: Record<string, unknown>[]
    let resultColumns: string[]
    let resultTypes: Record<string, ColumnType>

    const hasAggregations = ast.columns.some(
      (col) => typeof col !== 'string' && 'type' in col && this.isAggregationType(col.type)
    )

    if (ast.groupBy || hasAggregations) {
      const grouped = this.applyGroupBy(filteredRows, ast.columns, ast.groupBy || [])
      resultRows = grouped.rows
      resultColumns = grouped.columns
      resultTypes = grouped.types
    } else {
      // Simple SELECT
      const projected = this.projectColumns(filteredRows, ast.columns, sourceSchema)
      resultRows = projected.rows
      resultColumns = projected.columns
      resultTypes = projected.types
    }

    // Apply HAVING
    if (ast.having) {
      resultRows = this.applyWhere(resultRows, ast.having, { columns: resultTypes, orderBy: [], primaryKey: [] })
    }

    // Apply ORDER BY
    if (ast.orderBy) {
      resultRows = this.applyOrderBy(resultRows, ast.orderBy)
    }

    // Apply WITH FILL (gap filling for time series)
    if (ast.withFill && ast.orderBy && ast.orderBy.length > 0) {
      resultRows = this.applyWithFill(resultRows, ast.orderBy[0]!.column, ast.withFill, resultTypes)
    }

    // Apply LIMIT/OFFSET
    if (ast.offset) {
      resultRows = resultRows.slice(ast.offset)
    }
    if (ast.limit) {
      resultRows = resultRows.slice(0, ast.limit)
    }

    // Calculate bytes scanned (approximate)
    const bytesScanned = this.estimateBytesScanned(filteredRows, columnsScanned)

    return {
      rows: resultRows as T[],
      columns: resultColumns,
      columnTypes: resultTypes,
      rowCount: resultRows.length,
      executionTimeMs: 0, // Will be set by caller
      bytesScanned,
      columnsScanned,
    }
  }

  private isAggregationType(type: string): type is AggregationType {
    return ['count', 'sum', 'avg', 'min', 'max', 'uniq', 'quantile'].includes(type)
  }

  // ============================================================================
  // INTERNAL QUERY METHODS
  // ============================================================================

  private getRequiredColumns(ast: SQLSelectStatement, schema: ResolvedTableSchema): string[] {
    const columns = new Set<string>()

    // From SELECT list
    for (const col of ast.columns) {
      if (col === '*') {
        Object.keys(schema.columns).forEach((c) => columns.add(c))
      } else if (typeof col === 'string') {
        columns.add(col)
      } else if ('column' in col && col.column) {
        columns.add(col.column)
      } else if ('args' in col && col.args) {
        for (const arg of col.args) {
          if (typeof arg === 'string') columns.add(arg)
        }
      }
    }

    // From WHERE clause
    if (ast.where) {
      this.extractColumnsFromExpression(ast.where, columns)
    }

    // From GROUP BY
    if (ast.groupBy) {
      ast.groupBy.forEach((c) => columns.add(c))
    }

    // From ORDER BY
    if (ast.orderBy) {
      ast.orderBy.forEach((o) => columns.add(o.column))
    }

    return Array.from(columns)
  }

  private extractColumnsFromExpression(expr: SQLExpression, columns: Set<string>): void {
    if (expr.condition) {
      columns.add(expr.condition.column)
    }
    if (expr.left) {
      this.extractColumnsFromExpression(expr.left, columns)
    }
    if (expr.right) {
      this.extractColumnsFromExpression(expr.right, columns)
    }
  }

  private applyWhere(
    rows: Record<string, unknown>[],
    expr: SQLExpression,
    schema: ResolvedTableSchema
  ): Record<string, unknown>[] {
    return rows.filter((row) => this.evaluateExpression(row, expr, schema))
  }

  private evaluateExpression(row: Record<string, unknown>, expr: SQLExpression, schema: ResolvedTableSchema): boolean {
    if (expr.type === 'logical') {
      const left = this.evaluateExpression(row, expr.left!, schema)
      const right = this.evaluateExpression(row, expr.right!, schema)
      return expr.operator === 'AND' ? left && right : left || right
    }

    if (expr.type === 'condition' && expr.condition) {
      const { column, operator, value, values } = expr.condition
      const columnValue = this.resolveColumnValue(row, column, schema)

      switch (operator) {
        case '=':
          return columnValue === value
        case '!=':
        case '<>':
          return columnValue !== value
        case '<':
          return (columnValue as number) < (value as number)
        case '<=':
          return (columnValue as number) <= (value as number)
        case '>':
          return (columnValue as number) > (value as number)
        case '>=':
          return (columnValue as number) >= (value as number)
        case 'IN':
          return (values as unknown[]).includes(columnValue)
        case 'NOT IN':
          return !(values as unknown[]).includes(columnValue)
        case 'BETWEEN':
          return (
            (columnValue as number) >= (values![0] as number) && (columnValue as number) <= (values![1] as number)
          )
        case 'LIKE':
          return this.matchLike(columnValue as string, value as string)
        case 'IS NULL':
          return columnValue === null || columnValue === undefined
        case 'IS NOT NULL':
          return columnValue !== null && columnValue !== undefined
        default:
          return false
      }
    }

    return true
  }

  private resolveColumnValue(row: Record<string, unknown>, column: string, schema: ResolvedTableSchema): unknown {
    // Check if it's a function call
    if (column.includes('(')) {
      // Extract function name and args (simplified)
      const match = column.match(/^(\w+)\((.*)\)$/)
      if (match) {
        const [, funcName, args] = match
        return this.evaluateFunction(funcName!, args ? args.split(',').map((a) => a.trim()) : [], row, schema)
      }
    }
    return row[column]
  }

  private matchLike(value: string, pattern: string): boolean {
    // Convert SQL LIKE pattern to regex
    const regexPattern = pattern
      .replace(/%/g, '.*')
      .replace(/_/g, '.')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
    return new RegExp(`^${regexPattern}$`).test(value)
  }

  private projectColumns(
    rows: Record<string, unknown>[],
    columns: (string | SQLAggregation | SQLFunction)[],
    schema: ResolvedTableSchema
  ): { rows: Record<string, unknown>[]; columns: string[]; types: Record<string, ColumnType> } {
    const resultColumns: string[] = []
    const resultTypes: Record<string, ColumnType> = {}

    // Handle SELECT *
    if (columns.length === 1 && columns[0] === '*') {
      return {
        rows,
        columns: Object.keys(schema.columns),
        types: schema.columns,
      }
    }

    // Determine output columns
    for (const col of columns) {
      if (col === '*') {
        Object.keys(schema.columns).forEach((c) => {
          resultColumns.push(c)
          resultTypes[c] = schema.columns[c]!
        })
      } else if (typeof col === 'string') {
        if (!schema.columns[col]) {
          throw new AnalyticsError(`Column '${col}' does not exist`, 'COLUMN_NOT_FOUND')
        }
        resultColumns.push(col)
        resultTypes[col] = schema.columns[col]
      } else if ('type' in col) {
        // Aggregation - shouldn't be here without GROUP BY
        const alias = col.alias || `${col.type}_${col.column || 'all'}`
        resultColumns.push(alias)
        resultTypes[alias] = 'Float64'
      } else if ('name' in col) {
        // Function
        const alias = col.alias || col.name
        resultColumns.push(alias)
        resultTypes[alias] = this.inferFunctionReturnType(col.name, schema)
      }
    }

    // Project rows
    const resultRows = rows.map((row) => {
      const result: Record<string, unknown> = {}
      for (const col of columns) {
        if (col === '*') {
          Object.assign(result, row)
        } else if (typeof col === 'string') {
          result[col] = row[col]
        } else if ('name' in col) {
          const alias = col.alias || col.name
          result[alias] = this.evaluateFunction(col.name, col.args, row, schema)
        }
      }
      return result
    })

    return { rows: resultRows, columns: resultColumns, types: resultTypes }
  }

  private applyGroupBy(
    rows: Record<string, unknown>[],
    selectColumns: (string | SQLAggregation | SQLFunction)[],
    groupByColumns: string[]
  ): { rows: Record<string, unknown>[]; columns: string[]; types: Record<string, ColumnType> } {
    // Build a map from GROUP BY column name to select column definition
    // This handles cases like GROUP BY hour where hour is defined as toStartOfHour(timestamp)
    const columnAliasMap = new Map<string, SQLFunction>()
    for (const col of selectColumns) {
      if (typeof col !== 'string' && 'name' in col && col.alias) {
        columnAliasMap.set(col.alias, col)
      }
    }

    // Pre-compute function values for rows before grouping
    const enrichedRows = rows.map((row) => {
      const enriched = { ...row }
      for (const col of selectColumns) {
        if (typeof col !== 'string' && 'name' in col) {
          const alias = col.alias || col.name
          enriched[alias] = this.evaluateFunction(col.name, col.args, row, { columns: {}, orderBy: [], primaryKey: [] })
        }
      }
      return enriched
    })

    // Group rows - use enriched rows which have computed function values
    const groups = new Map<string, Record<string, unknown>[]>()

    for (const row of enrichedRows) {
      const keyParts: string[] = []
      for (const col of groupByColumns) {
        // Check if the GROUP BY column references a computed function
        const computedValue = row[col]
        if (computedValue instanceof Date) {
          keyParts.push(computedValue.toISOString())
        } else {
          keyParts.push(String(computedValue))
        }
      }
      const key = keyParts.join('|')
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(row)
    }

    // If no GROUP BY but has aggregations, treat all rows as one group
    if (groupByColumns.length === 0) {
      groups.set('__all__', enrichedRows)
    }

    // Compute aggregations for each group
    const resultColumns: string[] = []
    const resultTypes: Record<string, ColumnType> = {}

    // Determine columns from SELECT
    for (const col of selectColumns) {
      if (typeof col === 'string') {
        resultColumns.push(col)
        resultTypes[col] = 'String' // Will be refined below
      } else if ('type' in col) {
        const alias = col.alias
        resultColumns.push(alias)
        resultTypes[alias] = col.type === 'count' || col.type === 'uniq' ? 'UInt64' : 'Float64'
      } else if ('name' in col) {
        const alias = col.alias || col.name
        resultColumns.push(alias)
        resultTypes[alias] = this.inferFunctionReturnType(col.name, { columns: {}, orderBy: [], primaryKey: [] })
      }
    }

    const resultRows: Record<string, unknown>[] = []

    for (const [, groupRows] of groups) {
      const result: Record<string, unknown> = {}

      // Copy GROUP BY columns from first row (already has computed values)
      for (const col of groupByColumns) {
        result[col] = groupRows[0]![col]
      }

      // Compute aggregations and copy function results
      for (const col of selectColumns) {
        if (typeof col === 'string') {
          // GROUP BY column or direct column reference
          result[col] = groupRows[0]![col]
        } else if ('type' in col) {
          result[col.alias!] = this.computeAggregation(col, groupRows)
        } else if ('name' in col) {
          // Function result - already computed in enriched rows
          const alias = col.alias || col.name
          result[alias] = groupRows[0]![alias]
        }
      }

      resultRows.push(result)
    }

    return { rows: resultRows, columns: resultColumns, types: resultTypes }
  }

  private computeAggregation(agg: SQLAggregation, rows: Record<string, unknown>[]): number {
    let values: unknown[]

    if (agg.columnFunc) {
      // Nested function - evaluate function for each row
      const emptySchema: ResolvedTableSchema = { columns: {}, orderBy: [], primaryKey: [] }
      values = rows
        .map((r) => this.evaluateFunction(agg.columnFunc!.name, agg.columnFunc!.args, r, emptySchema))
        .filter((v) => v !== null && v !== undefined)
    } else if (agg.column) {
      // Check if column is actually a pre-computed alias (from applyGroupBy enrichment)
      if (rows.length > 0 && rows[0]![agg.column] !== undefined) {
        values = rows.map((r) => r[agg.column!]).filter((v) => v !== null && v !== undefined)
      } else {
        // Simple column access
        values = rows.map((r) => r[agg.column!]).filter((v) => v !== null && v !== undefined)
      }
    } else {
      values = rows
    }

    switch (agg.type) {
      case 'count':
        return values.length
      case 'sum':
        return (values as number[]).reduce((a, b) => a + (b as number), 0)
      case 'avg':
        return values.length > 0 ? (values as number[]).reduce((a, b) => a + (b as number), 0) / values.length : 0
      case 'min':
        return values.length > 0 ? Math.min(...(values as number[])) : 0
      case 'max':
        return values.length > 0 ? Math.max(...(values as number[])) : 0
      case 'uniq':
        return new Set(values.map((v) => String(v))).size
      case 'quantile':
        return this.computeQuantile(values as number[], agg.args?.[0] || 0.5)
      default:
        return 0
    }
  }

  private computeQuantile(values: number[], p: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const index = (sorted.length - 1) * p
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    if (lower === upper) return sorted[lower]!
    return sorted[lower]! * (upper - index) + sorted[upper]! * (index - lower)
  }

  private applyOrderBy(rows: Record<string, unknown>[], orderBy: SQLOrderBy[]): Record<string, unknown>[] {
    return [...rows].sort((a, b) => {
      for (const { column, direction } of orderBy) {
        const aVal = a[column]
        const bVal = b[column]

        let cmp: number
        if (aVal instanceof Date && bVal instanceof Date) {
          cmp = aVal.getTime() - bVal.getTime()
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal
        } else {
          cmp = String(aVal).localeCompare(String(bVal))
        }

        if (cmp !== 0) {
          return direction === 'DESC' ? -cmp : cmp
        }
      }
      return 0
    })
  }

  private applyWithFill(
    rows: Record<string, unknown>[],
    timeColumn: string,
    withFill: { from: Date | string | unknown; to: Date | string | unknown; step: string },
    types: Record<string, ColumnType>
  ): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = []

    // Parse step interval
    const stepMatch = (withFill.step as string).match(/^(\d+)\s*(\w+)$/i)
    if (!stepMatch) return rows

    const stepValue = parseInt(stepMatch[1]!, 10)
    const stepUnit = stepMatch[2]!.toUpperCase()

    // Convert from/to to dates
    let fromDate = this.resolveDateTime(withFill.from)
    let toDate = this.resolveDateTime(withFill.to)

    // Create a map of existing data
    const existingData = new Map<number, Record<string, unknown>>()
    for (const row of rows) {
      const time = row[timeColumn] instanceof Date ? row[timeColumn] : new Date(row[timeColumn] as string)
      existingData.set((time as Date).getTime(), row)
    }

    // Fill gaps
    let current = new Date(fromDate)
    while (current < toDate) {
      const existing = existingData.get(current.getTime())
      if (existing) {
        result.push(existing)
      } else {
        // Create empty row with zeros for numeric columns
        const emptyRow: Record<string, unknown> = { [timeColumn]: new Date(current) }
        for (const [col, type] of Object.entries(types)) {
          if (col !== timeColumn) {
            if (type.startsWith('Int') || type.startsWith('UInt') || type.startsWith('Float')) {
              emptyRow[col] = 0
            } else {
              emptyRow[col] = null
            }
          }
        }
        result.push(emptyRow)
      }

      // Advance by step
      current = this.addInterval(current, stepValue, stepUnit)
    }

    return result
  }

  private resolveDateTime(value: unknown): Date {
    if (value instanceof Date) return value
    if (typeof value === 'string') return new Date(value)
    if (typeof value === 'object' && value !== null && 'function' in value) {
      const func = value as { function: string; args: unknown[] }
      if (func.function === 'todatetime' || func.function === 'toDateTime') {
        return new Date(func.args[0] as string)
      }
      if (func.function === 'now') {
        return new Date()
      }
    }
    return new Date()
  }

  private addInterval(date: Date, value: number, unit: string): Date {
    const result = new Date(date)
    switch (unit) {
      case 'SECOND':
        result.setSeconds(result.getSeconds() + value)
        break
      case 'MINUTE':
        result.setMinutes(result.getMinutes() + value)
        break
      case 'HOUR':
        result.setHours(result.getHours() + value)
        break
      case 'DAY':
        result.setDate(result.getDate() + value)
        break
      case 'WEEK':
        result.setDate(result.getDate() + value * 7)
        break
      case 'MONTH':
        result.setMonth(result.getMonth() + value)
        break
      case 'YEAR':
        result.setFullYear(result.getFullYear() + value)
        break
    }
    return result
  }

  // ============================================================================
  // FUNCTION EVALUATION
  // ============================================================================

  private evaluateFunction(
    name: string,
    args: (string | number | SQLFunction)[],
    row: Record<string, unknown>,
    schema: ResolvedTableSchema
  ): unknown {
    const funcName = name.toLowerCase()

    // Resolve arguments
    const resolvedArgs = args.map((arg) => {
      if (typeof arg === 'string' && row[arg] !== undefined) {
        return row[arg]
      }
      if (typeof arg === 'object' && 'name' in arg) {
        return this.evaluateFunction(arg.name, arg.args, row, schema)
      }
      return arg
    })

    // Time functions
    switch (funcName) {
      case 'tostartofhour':
        return this.toStartOfHour(resolvedArgs[0] as Date | string)
      case 'tostartofminute':
        return this.toStartOfMinute(resolvedArgs[0] as Date | string)
      case 'tostartofday':
        return this.toStartOfDay(resolvedArgs[0] as Date | string)
      case 'toyyyymm':
        return this.toYYYYMM(resolvedArgs[0] as Date | string)
      case 'now':
        return new Date()
      case 'todatetime':
        return new Date(resolvedArgs[0] as string)

      // Array functions
      case 'length':
        return Array.isArray(resolvedArgs[0]) ? resolvedArgs[0].length : 0
      case 'has':
        return Array.isArray(resolvedArgs[0]) && resolvedArgs[0].includes(resolvedArgs[1])
      case 'arrayjoin':
        return resolvedArgs[0] // Will be handled specially

      // JSON functions
      case 'jsonextractstring':
        return this.jsonExtract(resolvedArgs[0], resolvedArgs[1] as string)
      case 'jsonextractfloat':
      case 'jsonextractint':
        const val = this.jsonExtract(resolvedArgs[0], resolvedArgs[1] as string)
        return typeof val === 'number' ? val : parseFloat(val as string)

      // Row number for window functions
      case 'row_number':
        return 0 // Will be computed during window function processing

      default:
        return null
    }
  }

  private evaluateFunctionOnGroup(func: SQLFunction, rows: Record<string, unknown>[]): unknown {
    // For functions that operate on a group (like toStartOfHour in GROUP BY context)
    if (rows.length === 0) return null
    return this.evaluateFunction(func.name, func.args ?? [], rows[0]!, { columns: {}, orderBy: [], primaryKey: [] })
  }

  private toStartOfHour(date: Date | string): Date {
    const d = date instanceof Date ? new Date(date) : new Date(date)
    d.setMinutes(0, 0, 0)
    return d
  }

  private toStartOfMinute(date: Date | string): Date {
    const d = date instanceof Date ? new Date(date) : new Date(date)
    d.setSeconds(0, 0)
    return d
  }

  private toStartOfDay(date: Date | string): Date {
    const d = date instanceof Date ? new Date(date) : new Date(date)
    d.setHours(0, 0, 0, 0)
    return d
  }

  private toYYYYMM(date: Date | string): number {
    const d = date instanceof Date ? date : new Date(date)
    return d.getFullYear() * 100 + (d.getMonth() + 1)
  }

  private jsonExtract(obj: unknown, path: string): unknown {
    if (typeof obj !== 'object' || obj === null) return null
    return (obj as Record<string, unknown>)[path]
  }

  private inferFunctionReturnType(name: string, schema: ResolvedTableSchema): ColumnType {
    const funcName = name.toLowerCase()
    switch (funcName) {
      case 'tostartofhour':
      case 'tostartofminute':
      case 'tostartofday':
      case 'now':
      case 'todatetime':
        return 'DateTime'
      case 'toyyyymm':
        return 'UInt32'
      case 'length':
        return 'UInt64'
      case 'has':
        return 'Boolean'
      case 'jsonextractstring':
        return 'String'
      case 'jsonextractfloat':
        return 'Float64'
      case 'jsonextractint':
        return 'Int64'
      default:
        return 'String'
    }
  }

  // ============================================================================
  // MATERIALIZED VIEWS
  // ============================================================================

  async createMaterializedView(name: string, config: MaterializedViewConfig): Promise<void> {
    if (this.materializedViews.has(name)) {
      throw new AnalyticsError(`Materialized view ${name} already exists`, 'VIEW_EXISTS')
    }

    const sourceTable = this.tables.get(config.source)
    if (!sourceTable) {
      throw new AnalyticsError(`Source table ${config.source} does not exist`, 'TABLE_NOT_FOUND')
    }

    // Parse the query to determine schema
    const ast = parseSQL(config.query)

    // Compute initial data
    const result = await this.query<Record<string, unknown>>(config.query)

    const view: MaterializedViewInternal = {
      name,
      source: config.source,
      query: config.query,
      ast,
      refreshInterval: config.refreshInterval,
      lastRefresh: new Date(),
      data: result.rows,
      schema: {
        columns: result.columnTypes,
        orderBy: [],
        primaryKey: [],
      },
    }

    this.materializedViews.set(name, view)
  }

  async dropMaterializedView(name: string): Promise<void> {
    if (!this.materializedViews.has(name)) {
      throw new AnalyticsError(`Materialized view ${name} does not exist`, 'VIEW_NOT_FOUND')
    }
    this.materializedViews.delete(name)
  }

  listMaterializedViews(): string[] {
    return Array.from(this.materializedViews.keys())
  }

  getMaterializedViewConfig(name: string): MaterializedViewConfig | undefined {
    const view = this.materializedViews.get(name)
    if (!view) return undefined
    return {
      source: view.source,
      query: view.query,
      refreshInterval: view.refreshInterval,
    }
  }

  private async refreshMaterializedView(name: string, newRows: Record<string, unknown>[]): Promise<void> {
    const view = this.materializedViews.get(name)
    if (!view) return

    // Re-execute the query to get updated results
    // In a real implementation, this would be incremental
    const result = await this.query<Record<string, unknown>>(view.query)
    view.data = result.rows
    view.lastRefresh = new Date()
  }

  // ============================================================================
  // COLUMNAR ACCESS (for testing/internal use)
  // ============================================================================

  getColumnData(tableName: string, columnName: string): unknown[] {
    const table = this.tables.get(tableName)
    if (!table) {
      throw new AnalyticsError(`Table ${tableName} does not exist`, 'TABLE_NOT_FOUND')
    }
    return table.getColumnData(columnName)
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private resolveSchema(schema: TableSchema): ResolvedTableSchema {
    const columns: Record<string, ColumnType> = {}
    for (const [name, def] of Object.entries(schema.columns)) {
      columns[name] = typeof def === 'string' ? def : def.type
    }
    return {
      columns,
      orderBy: schema.orderBy || [],
      partitionBy: schema.partitionBy,
      primaryKey: schema.primaryKey || schema.orderBy || [],
    }
  }

  private estimateBytesScanned(rows: Record<string, unknown>[], columns: string[]): number {
    let bytes = 0
    for (const row of rows) {
      for (const col of columns) {
        const val = row[col]
        if (typeof val === 'string') {
          bytes += val.length * 2
        } else if (typeof val === 'number') {
          bytes += 8
        } else if (val instanceof Date) {
          bytes += 8
        } else if (val !== null && val !== undefined) {
          bytes += JSON.stringify(val).length
        }
      }
    }
    return bytes
  }
}

// ============================================================================
// COLUMNAR TABLE STORAGE
// ============================================================================

class ColumnarTable {
  readonly name: string
  readonly schema: ResolvedTableSchema
  private columns = new Map<string, ColumnStore>()
  private rowCount = 0

  constructor(name: string, schema: ResolvedTableSchema) {
    this.name = name
    this.schema = schema

    // Initialize column stores
    for (const colName of Object.keys(schema.columns)) {
      this.columns.set(colName, { values: [], stats: { count: 0, nullCount: 0 } })
    }
  }

  insert(rows: Record<string, unknown>[]): void {
    for (const row of rows) {
      for (const [colName, colStore] of this.columns) {
        const value = row[colName]
        colStore.values.push(value)
        colStore.stats.count++
        if (value === null || value === undefined) {
          colStore.stats.nullCount++
        }
      }
      this.rowCount++
    }
  }

  getRows(): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < this.rowCount; i++) {
      const row: Record<string, unknown> = {}
      for (const [colName, colStore] of this.columns) {
        row[colName] = colStore.values[i]
      }
      rows.push(row)
    }
    return rows
  }

  getColumnData(columnName: string): unknown[] {
    const store = this.columns.get(columnName)
    if (!store) {
      throw new AnalyticsError(`Column ${columnName} does not exist`, 'COLUMN_NOT_FOUND')
    }
    return store.values
  }
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface MaterializedViewInternal extends MaterializedView {
  ast: SQLSelectStatement
  data: Record<string, unknown>[]
}
