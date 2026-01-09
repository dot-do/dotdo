/**
 * @dotdo/duckdb - DuckDB SDK compat
 *
 * Drop-in replacement for duckdb-node backed by DO SQLite.
 * This in-memory implementation matches the DuckDB Node.js API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://duckdb.org/docs/api/nodejs/reference
 */
import type {
  IDatabase,
  IConnection,
  IStatement,
  DatabaseConfig,
  ExtendedDuckDBConfig,
  QueryResult,
  DatabaseCallback,
  CloseCallback,
  RunCallback,
  AllCallback,
  GetCallback,
  EachRowCallback,
  EachCompleteCallback,
  FinalizeCallback,
} from './types'
import { DuckDBError } from './types'

// ============================================================================
// IN-MEMORY SQL ENGINE
// ============================================================================

interface TableSchema {
  name: string
  columns: string[]
  columnTypes: string[]
  primaryKey?: string
  uniqueConstraints: string[]
  autoIncrement?: string
  defaults: Map<string, any>
}

interface StoredRow {
  rowid: number
  values: Map<string, any>
}

class InMemorySQLEngine {
  private tables = new Map<string, TableSchema>()
  private data = new Map<string, StoredRow[]>()
  private lastRowId = 0

  execute(
    sql: string,
    params: any[] = []
  ): { columns: string[]; rows: any[][]; changes: number; lastRowId: number } {
    const normalizedSql = sql.trim()
    const upperSql = normalizedSql.toUpperCase()

    if (upperSql.startsWith('CREATE TABLE')) {
      return this.executeCreateTable(normalizedSql)
    }

    if (upperSql.startsWith('CREATE INDEX') || upperSql.startsWith('CREATE UNIQUE INDEX')) {
      return { columns: [], rows: [], changes: 0, lastRowId: 0 }
    }

    if (upperSql.startsWith('DROP TABLE')) {
      return this.executeDropTable(normalizedSql)
    }

    if (upperSql.startsWith('INSERT')) {
      return this.executeInsert(normalizedSql, params)
    }

    if (upperSql.startsWith('SELECT')) {
      return this.executeSelect(normalizedSql, params)
    }

    if (upperSql.startsWith('UPDATE')) {
      return this.executeUpdate(normalizedSql, params)
    }

    if (upperSql.startsWith('DELETE')) {
      return this.executeDelete(normalizedSql, params)
    }

    throw new DuckDBError(`Unsupported SQL: ${sql}`, 'SYNTAX_ERROR', sql)
  }

  private executeCreateTable(
    sql: string
  ): { columns: string[]; rows: any[][]; changes: number; lastRowId: number } {
    const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(sql)

    const match = sql.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))\s*\(([^)]+)\)/i
    )
    if (!match) {
      throw new DuckDBError('Invalid CREATE TABLE syntax', 'SYNTAX_ERROR', sql)
    }

    const tableName = (match[1] || match[2]).toLowerCase()

    if (this.tables.has(tableName)) {
      if (ifNotExists) {
        return { columns: [], rows: [], changes: 0, lastRowId: 0 }
      }
      throw new DuckDBError(`Table "${tableName}" already exists`, 'CATALOG_ERROR', sql)
    }

    const columnDefs = this.splitColumnDefs(match[3])

    const columns: string[] = []
    const columnTypes: string[] = []
    const uniqueConstraints: string[] = []
    const defaults = new Map<string, any>()
    let primaryKey: string | undefined
    let autoIncrement: string | undefined

    for (const def of columnDefs) {
      const trimmed = def.trim()

      if (/^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT)/i.test(trimmed)) {
        const pkMatch = trimmed.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i)
        if (pkMatch) {
          primaryKey = pkMatch[1].split(',')[0].trim().toLowerCase()
        }
        continue
      }

      const parts = trimmed.split(/\s+/)
      const colName = parts[0].replace(/"/g, '').toLowerCase()
      const colType = parts[1]?.toUpperCase() ?? 'VARCHAR'

      columns.push(colName)
      columnTypes.push(colType)

      const upperDef = trimmed.toUpperCase()
      if (upperDef.includes('PRIMARY KEY')) {
        primaryKey = colName
        uniqueConstraints.push(colName)
      }
      if (upperDef.includes('UNIQUE') && !uniqueConstraints.includes(colName)) {
        uniqueConstraints.push(colName)
      }

      // Parse DEFAULT value
      const defaultMatch = trimmed.match(/DEFAULT\s+(.+?)(?:\s+(?:NOT\s+NULL|PRIMARY|UNIQUE|$))/i)
      if (defaultMatch) {
        defaults.set(colName, this.parseDefaultValue(defaultMatch[1].trim()))
      }
    }

    this.tables.set(tableName, {
      name: tableName,
      columns,
      columnTypes,
      primaryKey,
      uniqueConstraints,
      autoIncrement,
      defaults,
    })
    this.data.set(tableName, [])

    return { columns: [], rows: [], changes: 0, lastRowId: 0 }
  }

  private parseDefaultValue(value: string): any {
    const upper = value.toUpperCase()
    if (upper === 'NULL') return null
    if (upper === 'TRUE') return true
    if (upper === 'FALSE') return false
    if (/^-?\d+$/.test(value)) return parseInt(value, 10)
    if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value)
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      return value.slice(1, -1)
    }
    return value
  }

  private splitColumnDefs(defs: string): string[] {
    const result: string[] = []
    let current = ''
    let depth = 0

    for (const char of defs) {
      if (char === '(') depth++
      if (char === ')') depth--
      if (char === ',' && depth === 0) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    if (current.trim()) {
      result.push(current.trim())
    }
    return result
  }

  private executeDropTable(
    sql: string
  ): { columns: string[]; rows: any[][]; changes: number; lastRowId: number } {
    const match = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))/i)
    if (!match) {
      throw new DuckDBError('Invalid DROP TABLE syntax', 'SYNTAX_ERROR', sql)
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const ifExists = /IF\s+EXISTS/i.test(sql)

    if (!this.tables.has(tableName)) {
      if (ifExists) {
        return { columns: [], rows: [], changes: 0, lastRowId: 0 }
      }
      throw new DuckDBError(`Table "${tableName}" does not exist`, 'CATALOG_ERROR', sql)
    }

    this.tables.delete(tableName)
    this.data.delete(tableName)

    return { columns: [], rows: [], changes: 0, lastRowId: 0 }
  }

  private executeInsert(
    sql: string,
    params: any[]
  ): { columns: string[]; rows: any[][]; changes: number; lastRowId: number } {
    const match = sql.match(
      /INSERT\s+INTO\s+(?:"([^"]+)"|(\w+))\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([^)]+)\)/i
    )
    if (!match) {
      throw new DuckDBError('Invalid INSERT syntax', 'SYNTAX_ERROR', sql)
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new DuckDBError(`Table "${tableName}" does not exist`, 'CATALOG_ERROR', sql)
    }

    const specifiedCols = match[3]
      ? match[3].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : schema.columns

    const valuesPart = match[4]
    const insertValues = this.parseValues(valuesPart, params)

    const values = new Map<string, any>()

    // Set defaults first
    for (const [col, defaultVal] of schema.defaults) {
      values.set(col, defaultVal)
    }

    // Then set specified values
    for (let i = 0; i < specifiedCols.length; i++) {
      values.set(specifiedCols[i], insertValues[i] ?? null)
    }

    // Check unique constraints
    const tableData = this.data.get(tableName) ?? []
    for (const constraint of schema.uniqueConstraints) {
      const newValue = values.get(constraint)
      for (const row of tableData) {
        if (
          row.values.get(constraint) === newValue &&
          newValue !== null &&
          newValue !== undefined
        ) {
          throw new DuckDBError(
            `Duplicate key value violates unique constraint`,
            'CONSTRAINT_ERROR',
            sql
          )
        }
      }
    }

    const rowid = ++this.lastRowId
    tableData.push({ rowid, values })

    return { columns: [], rows: [], changes: 1, lastRowId: rowid }
  }

  private parseValues(valuesPart: string, params: any[]): any[] {
    const values: any[] = []
    const parts = this.splitValues(valuesPart)

    for (const part of parts) {
      const trimmed = part.trim()

      const paramMatch = trimmed.match(/^\?$/)
      if (paramMatch) {
        values.push(params[values.length])
        continue
      }

      const posParamMatch = trimmed.match(/^\$(\d+)$/)
      if (posParamMatch) {
        const index = parseInt(posParamMatch[1], 10) - 1
        values.push(params[index])
        continue
      }

      if (trimmed.toUpperCase() === 'DEFAULT') {
        values.push(undefined)
        continue
      }

      if (
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
      ) {
        values.push(trimmed.slice(1, -1))
        continue
      }

      if (trimmed.toUpperCase() === 'NULL') {
        values.push(null)
        continue
      }

      if (/^-?\d+$/.test(trimmed)) {
        values.push(parseInt(trimmed, 10))
        continue
      }
      if (/^-?\d+\.\d+$/.test(trimmed)) {
        values.push(parseFloat(trimmed))
        continue
      }

      if (trimmed.toUpperCase() === 'TRUE') {
        values.push(true)
        continue
      }
      if (trimmed.toUpperCase() === 'FALSE') {
        values.push(false)
        continue
      }

      values.push(trimmed)
    }

    return values
  }

  private splitValues(valuesPart: string): string[] {
    const parts: string[] = []
    let current = ''
    let inString = false
    let stringChar = ''
    let depth = 0

    for (const char of valuesPart) {
      if (!inString && (char === "'" || char === '"')) {
        inString = true
        stringChar = char
        current += char
      } else if (inString && char === stringChar) {
        inString = false
        current += char
      } else if (!inString && char === '(') {
        depth++
        current += char
      } else if (!inString && char === ')') {
        depth--
        current += char
      } else if (!inString && depth === 0 && char === ',') {
        parts.push(current)
        current = ''
      } else {
        current += char
      }
    }

    if (current.length > 0) {
      parts.push(current)
    }

    return parts
  }

  private executeSelect(
    sql: string,
    params: any[]
  ): { columns: string[]; rows: any[][]; changes: number; lastRowId: number } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    // Handle simple SELECT without FROM (e.g., SELECT 1)
    if (!/FROM/i.test(normalized)) {
      const selectMatch = normalized.match(/SELECT\s+(.+)/i)
      if (selectMatch) {
        return this.executeSimpleSelect(selectMatch[1].trim())
      }
    }

    // Parse main SELECT
    const fromMatch = normalized.match(/SELECT\s+(.+?)\s+FROM\s+(?:"([^"]+)"|(\w+))/i)
    if (!fromMatch) {
      throw new DuckDBError('Invalid SELECT syntax', 'SYNTAX_ERROR', sql)
    }

    const columnsPart = fromMatch[1]
    const mainTable = (fromMatch[2] || fromMatch[3]).toLowerCase()

    const schema = this.tables.get(mainTable)
    if (!schema) {
      throw new DuckDBError(`Table "${mainTable}" does not exist`, 'CATALOG_ERROR', sql)
    }

    // Get rest of query
    const restMatch = normalized.match(new RegExp(`FROM\\s+(?:"${mainTable}"|${mainTable})(.*)$`, 'i'))
    const restOfQuery = restMatch?.[1]?.trim() ?? ''

    let tableData = [...(this.data.get(mainTable) ?? [])]

    // Check for GROUP BY
    const groupByMatch = restOfQuery.match(/GROUP\s+BY\s+(.+?)(?:\s+HAVING|\s+ORDER|\s+LIMIT|\s*$)/i)
    const havingMatch = restOfQuery.match(/HAVING\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s*$)/i)

    // Parse columns (handle aggregates)
    const { selectedColumns, aggregates, aliases } = this.parseSelectColumns(columnsPart, schema)

    // Apply WHERE filter
    const paramIndex = { value: 0 }
    const whereMatch = restOfQuery.match(
      /WHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|\s+OFFSET|\s*$)/i
    )
    if (whereMatch) {
      const condition = whereMatch[1].trim()
      tableData = this.applyWhere(tableData, condition, params, paramIndex)
    }

    // Handle GROUP BY with aggregates
    if (groupByMatch || aggregates.length > 0) {
      const groupByCol = groupByMatch
        ? groupByMatch[1].trim().replace(/"/g, '').toLowerCase()
        : null

      const result = this.executeGroupBy(tableData, selectedColumns, aggregates, aliases, groupByCol, havingMatch?.[1])

      // Apply ORDER BY to grouped results
      const orderMatch = restOfQuery.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|\s*$)/i)
      if (orderMatch) {
        result.rows = this.applyOrderByToRows(result.rows, result.columns, orderMatch[1].trim())
      }

      return { ...result, changes: 0, lastRowId: 0 }
    }

    // Apply ORDER BY
    const orderMatch = restOfQuery.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|\s*$)/i)
    if (orderMatch) {
      tableData = this.applyOrderBy(tableData, orderMatch[1].trim())
    }

    // Apply OFFSET first (before LIMIT)
    const offsetMatch = restOfQuery.match(/OFFSET\s+(\d+)/i)
    if (offsetMatch) {
      const offset = parseInt(offsetMatch[1], 10)
      tableData = tableData.slice(offset)
    }

    // Apply LIMIT
    const limitMatch = restOfQuery.match(/LIMIT\s+(\d+)/i)
    if (limitMatch) {
      tableData = tableData.slice(0, parseInt(limitMatch[1], 10))
    }

    // Validate columns exist
    const outputCols: string[] = []
    for (const col of selectedColumns) {
      if (col === '*') {
        outputCols.push(...schema.columns)
      } else if (!schema.columns.includes(col) && !aliases.has(col)) {
        throw new DuckDBError(`Column "${col}" does not exist`, 'BINDER_ERROR', sql)
      } else {
        outputCols.push(col)
      }
    }

    // Build result
    const rows = tableData.map((row) =>
      outputCols.map((col) => row.values.get(col) ?? null)
    )

    return {
      columns: outputCols,
      rows,
      changes: 0,
      lastRowId: 0,
    }
  }

  private executeSimpleSelect(
    expr: string
  ): { columns: string[]; rows: any[][]; changes: number; lastRowId: number } {
    if (/^\d+$/.test(expr)) {
      return { columns: ['?column?'], rows: [[parseInt(expr, 10)]], changes: 0, lastRowId: 0 }
    }
    if (/^'[^']*'$/.test(expr)) {
      return { columns: ['?column?'], rows: [[expr.slice(1, -1)]], changes: 0, lastRowId: 0 }
    }
    return { columns: ['?column?'], rows: [['result']], changes: 0, lastRowId: 0 }
  }

  private parseSelectColumns(
    columnsPart: string,
    schema: TableSchema
  ): { selectedColumns: string[]; aggregates: Array<{ fn: string; col: string; alias: string }>; aliases: Map<string, string> } {
    const selectedColumns: string[] = []
    const aggregates: Array<{ fn: string; col: string; alias: string }> = []
    const aliases = new Map<string, string>()

    if (columnsPart.trim() === '*') {
      selectedColumns.push('*')
      return { selectedColumns, aggregates, aliases }
    }

    const parts = this.splitColumns(columnsPart)

    for (const part of parts) {
      const trimmed = part.trim()

      // Check for aggregate functions
      const aggMatch = trimmed.match(/^(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(\*|\w+)\s*\)(?:\s+AS\s+(\w+))?$/i)
      if (aggMatch) {
        const fn = aggMatch[1].toUpperCase()
        const col = aggMatch[2].toLowerCase()
        const alias = aggMatch[3]?.toLowerCase() ?? `${fn.toLowerCase()}_${col}`
        aggregates.push({ fn, col, alias })
        selectedColumns.push(alias)
        aliases.set(alias, alias)
        continue
      }

      // Check for alias
      const aliasMatch = trimmed.match(/^(.+?)\s+AS\s+(\w+)$/i)
      if (aliasMatch) {
        const col = aliasMatch[1].trim().replace(/"/g, '').toLowerCase()
        const alias = aliasMatch[2].toLowerCase()
        selectedColumns.push(col)
        aliases.set(alias, col)
        continue
      }

      // Simple column
      const col = trimmed.replace(/"/g, '').toLowerCase()
      selectedColumns.push(col)
    }

    return { selectedColumns, aggregates, aliases }
  }

  private splitColumns(columnsPart: string): string[] {
    const parts: string[] = []
    let current = ''
    let depth = 0

    for (const char of columnsPart) {
      if (char === '(') depth++
      if (char === ')') depth--
      if (char === ',' && depth === 0) {
        parts.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    if (current.trim()) {
      parts.push(current.trim())
    }
    return parts
  }

  private executeGroupBy(
    data: StoredRow[],
    selectedColumns: string[],
    aggregates: Array<{ fn: string; col: string; alias: string }>,
    aliases: Map<string, string>,
    groupByCol: string | null,
    havingCondition?: string
  ): { columns: string[]; rows: any[][] } {
    const groups = new Map<any, StoredRow[]>()

    if (groupByCol) {
      for (const row of data) {
        const key = row.values.get(groupByCol)
        if (!groups.has(key)) {
          groups.set(key, [])
        }
        groups.get(key)!.push(row)
      }
    } else {
      // No GROUP BY, treat all rows as one group
      groups.set('__all__', data)
    }

    const resultRows: any[][] = []
    const outputCols: string[] = []

    // Build output columns
    if (groupByCol) {
      outputCols.push(groupByCol)
    }
    for (const agg of aggregates) {
      outputCols.push(agg.alias)
    }

    for (const [key, rows] of groups) {
      const resultRow: any[] = []

      if (groupByCol) {
        resultRow.push(key)
      }

      for (const agg of aggregates) {
        const value = this.computeAggregate(agg.fn, agg.col, rows)
        resultRow.push(value)
      }

      // Apply HAVING filter
      if (havingCondition) {
        const passesHaving = this.evaluateHaving(havingCondition, aggregates, rows)
        if (!passesHaving) continue
      }

      resultRows.push(resultRow)
    }

    return { columns: outputCols, rows: resultRows }
  }

  private computeAggregate(fn: string, col: string, rows: StoredRow[]): any {
    switch (fn) {
      case 'COUNT':
        if (col === '*') {
          return rows.length
        }
        return rows.filter((r) => r.values.get(col) !== null).length

      case 'SUM': {
        let sum = 0
        for (const row of rows) {
          const val = row.values.get(col)
          if (val !== null && typeof val === 'number') {
            sum += val
          }
        }
        return sum
      }

      case 'AVG': {
        let sum = 0
        let count = 0
        for (const row of rows) {
          const val = row.values.get(col)
          if (val !== null && typeof val === 'number') {
            sum += val
            count++
          }
        }
        return count > 0 ? sum / count : null
      }

      case 'MIN': {
        let min: any = null
        for (const row of rows) {
          const val = row.values.get(col)
          if (val !== null && (min === null || val < min)) {
            min = val
          }
        }
        return min
      }

      case 'MAX': {
        let max: any = null
        for (const row of rows) {
          const val = row.values.get(col)
          if (val !== null && (max === null || val > max)) {
            max = val
          }
        }
        return max
      }

      default:
        return null
    }
  }

  private evaluateHaving(
    condition: string,
    aggregates: Array<{ fn: string; col: string; alias: string }>,
    rows: StoredRow[]
  ): boolean {
    // Parse condition like "SUM(price) > 100"
    const match = condition.match(/(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(\*|\w+)\s*\)\s*(>|>=|<|<=|=|!=)\s*(\d+(?:\.\d+)?)/i)
    if (!match) return true

    const fn = match[1].toUpperCase()
    const col = match[2].toLowerCase()
    const op = match[3]
    const value = parseFloat(match[4])

    const aggValue = this.computeAggregate(fn, col, rows)

    switch (op) {
      case '>':
        return aggValue > value
      case '>=':
        return aggValue >= value
      case '<':
        return aggValue < value
      case '<=':
        return aggValue <= value
      case '=':
        return aggValue === value
      case '!=':
        return aggValue !== value
      default:
        return true
    }
  }

  private applyWhere(data: StoredRow[], condition: string, params: any[], paramIndex: { value: number }): StoredRow[] {
    const andParts = condition.split(/\s+AND\s+/i)
    let result = data

    for (const part of andParts) {
      result = this.applySingleCondition(result, part.trim(), params, paramIndex)
    }

    return result
  }

  private applySingleCondition(data: StoredRow[], condition: string, params: any[], paramIndex: { value: number }): StoredRow[] {
    // Handle col >= value
    const gteMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*>=\s*(.+)/i)
    if (gteMatch) {
      const colName = gteMatch[1].toLowerCase()
      const value = this.resolveValue(gteMatch[2].trim(), params, paramIndex)
      return data.filter((row) => (row.values.get(colName) ?? 0) >= value)
    }

    // Handle col <= value
    const lteMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*<=\s*(.+)/i)
    if (lteMatch) {
      const colName = lteMatch[1].toLowerCase()
      const value = this.resolveValue(lteMatch[2].trim(), params, paramIndex)
      return data.filter((row) => (row.values.get(colName) ?? 0) <= value)
    }

    // Handle col != value or col <> value
    const neqMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*(?:!=|<>)\s*(.+)/i)
    if (neqMatch) {
      const colName = neqMatch[1].toLowerCase()
      const value = this.resolveValue(neqMatch[2].trim(), params, paramIndex)
      return data.filter((row) => row.values.get(colName) !== value)
    }

    // Handle col > value
    const gtMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*>\s*(.+)/i)
    if (gtMatch) {
      const colName = gtMatch[1].toLowerCase()
      const value = this.resolveValue(gtMatch[2].trim(), params, paramIndex)
      return data.filter((row) => (row.values.get(colName) ?? 0) > value)
    }

    // Handle col < value
    const ltMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*<\s*(.+)/i)
    if (ltMatch) {
      const colName = ltMatch[1].toLowerCase()
      const value = this.resolveValue(ltMatch[2].trim(), params, paramIndex)
      return data.filter((row) => (row.values.get(colName) ?? 0) < value)
    }

    // Handle col = value
    const eqMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*=\s*(.+)/i)
    if (eqMatch) {
      const colName = eqMatch[1].toLowerCase()
      const value = this.resolveValue(eqMatch[2].trim(), params, paramIndex)
      return data.filter((row) => row.values.get(colName) === value)
    }

    // Handle col IS NULL
    const isNullMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s+IS\s+NULL/i)
    if (isNullMatch) {
      const colName = isNullMatch[1].toLowerCase()
      return data.filter((row) => row.values.get(colName) === null)
    }

    // Handle col IS NOT NULL
    const isNotNullMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s+IS\s+NOT\s+NULL/i)
    if (isNotNullMatch) {
      const colName = isNotNullMatch[1].toLowerCase()
      return data.filter((row) => row.values.get(colName) !== null)
    }

    return data
  }

  private resolveValue(valuePart: string, params: any[], paramIndex: { value: number }): any {
    // Handle ? placeholder
    if (valuePart === '?') {
      return params[paramIndex.value++]
    }

    // Handle $1, $2, etc.
    const paramMatch = valuePart.match(/^\$(\d+)$/)
    if (paramMatch) {
      return params[parseInt(paramMatch[1], 10) - 1]
    }

    // Handle quoted strings
    if (
      (valuePart.startsWith("'") && valuePart.endsWith("'")) ||
      (valuePart.startsWith('"') && valuePart.endsWith('"'))
    ) {
      return valuePart.slice(1, -1)
    }

    // Handle NULL
    if (valuePart.toUpperCase() === 'NULL') {
      return null
    }

    // Handle booleans
    if (valuePart.toUpperCase() === 'TRUE') return true
    if (valuePart.toUpperCase() === 'FALSE') return false

    // Handle numbers
    if (/^-?\d+$/.test(valuePart)) return parseInt(valuePart, 10)
    if (/^-?\d+\.\d+$/.test(valuePart)) return parseFloat(valuePart)

    return valuePart
  }

  private applyOrderBy(data: StoredRow[], orderBy: string): StoredRow[] {
    const parts = orderBy.split(',').map((p) => {
      const trimmed = p.trim()
      const descMatch = trimmed.match(/(.+?)\s+DESC/i)
      const ascMatch = trimmed.match(/(.+?)\s+ASC/i)
      const col = (descMatch?.[1] || ascMatch?.[1] || trimmed).replace(/"/g, '').toLowerCase()
      const desc = !!descMatch
      return { col, desc }
    })

    return [...data].sort((a, b) => {
      for (const { col, desc } of parts) {
        const aVal = a.values.get(col)
        const bVal = b.values.get(col)
        if (aVal === bVal) continue
        if (aVal === null) return desc ? -1 : 1
        if (bVal === null) return desc ? 1 : -1
        if (aVal < bVal) return desc ? 1 : -1
        if (aVal > bVal) return desc ? -1 : 1
      }
      return 0
    })
  }

  private applyOrderByToRows(rows: any[][], columns: string[], orderBy: string): any[][] {
    const parts = orderBy.split(',').map((p) => {
      const trimmed = p.trim()
      const descMatch = trimmed.match(/(.+?)\s+DESC/i)
      const ascMatch = trimmed.match(/(.+?)\s+ASC/i)
      const col = (descMatch?.[1] || ascMatch?.[1] || trimmed).replace(/"/g, '').toLowerCase()
      const desc = !!descMatch
      const colIndex = columns.indexOf(col)
      return { colIndex, desc }
    })

    return [...rows].sort((a, b) => {
      for (const { colIndex, desc } of parts) {
        if (colIndex < 0) continue
        const aVal = a[colIndex]
        const bVal = b[colIndex]
        if (aVal === bVal) continue
        if (aVal === null) return desc ? -1 : 1
        if (bVal === null) return desc ? 1 : -1
        if (aVal < bVal) return desc ? 1 : -1
        if (aVal > bVal) return desc ? -1 : 1
      }
      return 0
    })
  }

  private executeUpdate(
    sql: string,
    params: any[]
  ): { columns: string[]; rows: any[][]; changes: number; lastRowId: number } {
    const match = sql.match(
      /UPDATE\s+(?:"([^"]+)"|(\w+))\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i
    )
    if (!match) {
      throw new DuckDBError('Invalid UPDATE syntax', 'SYNTAX_ERROR', sql)
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const setPart = match[3]
    const wherePart = match[4]

    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new DuckDBError(`Table "${tableName}" does not exist`, 'CATALOG_ERROR', sql)
    }

    const tableData = this.data.get(tableName) ?? []

    // Count how many params are used by SET clause
    const setParamCount = (setPart.match(/\?/g) || []).length

    // Parse SET assignments with proper param index tracking
    const paramIndex = { value: 0 }
    const assignments = this.parseSetClause(setPart, params, paramIndex)

    // Apply WHERE filter with remaining params starting after SET params
    let toUpdate = [...tableData]
    if (wherePart) {
      toUpdate = this.applyWhere(toUpdate, wherePart, params, paramIndex)
    }

    // Apply updates
    for (const row of toUpdate) {
      for (const [col, value] of assignments) {
        if (value && typeof value === 'object' && value.type === 'expr') {
          const currentVal = row.values.get(value.refCol) ?? 0
          let newVal: number
          switch (value.op) {
            case '+':
              newVal = currentVal + value.operand
              break
            case '-':
              newVal = currentVal - value.operand
              break
            case '*':
              newVal = currentVal * value.operand
              break
            case '/':
              newVal = currentVal / value.operand
              break
            default:
              newVal = currentVal
          }
          row.values.set(col, newVal)
        } else {
          row.values.set(col, value)
        }
      }
    }

    return { columns: [], rows: [], changes: toUpdate.length, lastRowId: 0 }
  }

  private parseSetClause(setPart: string, params: any[], paramIndex: { value: number }): Map<string, any> {
    const assignments = new Map<string, any>()
    const parts = this.splitValues(setPart)

    for (const part of parts) {
      const match = part.match(/(?:"([^"]+)"|(\w+))\s*=\s*(.+)/i)
      if (match) {
        const col = (match[1] || match[2]).toLowerCase()
        const valuePart = match[3].trim()

        // Handle expressions like "age + 1"
        const exprMatch = valuePart.match(/^(\w+)\s*([+\-*/])\s*(\d+)$/)
        if (exprMatch) {
          const refCol = exprMatch[1].toLowerCase()
          const op = exprMatch[2]
          const operand = parseInt(exprMatch[3], 10)
          // Mark this as an expression to be evaluated per-row
          assignments.set(col, { type: 'expr', refCol, op, operand })
        } else {
          assignments.set(col, this.resolveValue(valuePart, params, paramIndex))
        }
      }
    }

    return assignments
  }

  private executeDelete(
    sql: string,
    params: any[]
  ): { columns: string[]; rows: any[][]; changes: number; lastRowId: number } {
    const match = sql.match(/DELETE\s+FROM\s+(?:"([^"]+)"|(\w+))(?:\s+WHERE\s+(.+))?$/i)
    if (!match) {
      throw new DuckDBError('Invalid DELETE syntax', 'SYNTAX_ERROR', sql)
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const wherePart = match[3]

    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new DuckDBError(`Table "${tableName}" does not exist`, 'CATALOG_ERROR', sql)
    }

    const tableData = this.data.get(tableName) ?? []

    const paramIndex = { value: 0 }
    let toDelete = [...tableData]
    if (wherePart) {
      toDelete = this.applyWhere(toDelete, wherePart, params, paramIndex)
    }

    const toDeleteRowIds = new Set(toDelete.map((r) => r.rowid))
    this.data.set(
      tableName,
      tableData.filter((r) => !toDeleteRowIds.has(r.rowid))
    )

    return { columns: [], rows: [], changes: toDelete.length, lastRowId: 0 }
  }
}

// ============================================================================
// STATEMENT IMPLEMENTATION
// ============================================================================

class DuckDBStatement implements IStatement {
  private db: InMemorySQLEngine
  private _sql: string
  private boundParams: any[] = []
  private finalized = false

  constructor(db: InMemorySQLEngine, sql: string) {
    this.db = db
    this._sql = sql
  }

  get sql(): string {
    return this._sql
  }

  bind(...params: any[]): this {
    this.boundParams = params
    return this
  }

  all<T = any>(...params: any[]): T[] {
    if (this.finalized) {
      throw new DuckDBError('Statement has been finalized', 'INVALID_STATE')
    }

    const effectiveParams = params.length > 0 ? params : this.boundParams
    const result = this.db.execute(this._sql, effectiveParams)

    return result.rows.map((row) => {
      const obj: any = {}
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i]] = row[i]
      }
      return obj as T
    })
  }

  get<T = any>(...params: any[]): T | undefined {
    const rows = this.all<T>(...params)
    return rows[0]
  }

  run(...params: any[]): QueryResult {
    if (this.finalized) {
      throw new DuckDBError('Statement has been finalized', 'INVALID_STATE')
    }

    const effectiveParams = params.length > 0 ? params : this.boundParams
    const result = this.db.execute(this._sql, effectiveParams)

    return {
      changes: result.changes,
      lastInsertRowid: result.lastRowId > 0 ? result.lastRowId : undefined,
    }
  }

  finalize(callback?: FinalizeCallback): void {
    this.finalized = true
    if (callback) {
      callback(null)
    }
  }
}

// ============================================================================
// CONNECTION IMPLEMENTATION
// ============================================================================

class DuckDBConnection implements IConnection {
  private db: InMemorySQLEngine

  constructor(db: InMemorySQLEngine) {
    this.db = db
  }

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const result = this.db.execute(sql, params)

    return result.rows.map((row) => {
      const obj: any = {}
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i]] = row[i]
      }
      return obj as T
    })
  }

  async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    const rows = await this.all<T>(sql, params)
    return rows[0]
  }

  async run(sql: string, params: any[] = []): Promise<QueryResult> {
    const result = this.db.execute(sql, params)

    return {
      changes: result.changes,
      lastInsertRowid: result.lastRowId > 0 ? result.lastRowId : undefined,
    }
  }

  async prepare(sql: string): Promise<IStatement> {
    return new DuckDBStatement(this.db, sql)
  }

  async close(): Promise<void> {
    // No-op for in-memory connection
  }
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

class DuckDBDatabase implements IDatabase {
  private db: InMemorySQLEngine
  private config: ExtendedDuckDBConfig
  private _path: string
  private _open = true

  constructor(
    pathOrConfig?: string | DatabaseConfig,
    configOrCallback?: DatabaseConfig | DatabaseCallback,
    callback?: DatabaseCallback
  ) {
    // Parse arguments
    if (typeof pathOrConfig === 'string') {
      this._path = pathOrConfig || ':memory:'
    } else {
      this._path = ':memory:'
    }

    if (typeof configOrCallback === 'function') {
      callback = configOrCallback
      this.config = {}
    } else if (configOrCallback) {
      this.config = configOrCallback as ExtendedDuckDBConfig
    } else {
      this.config = {}
    }

    this.db = new InMemorySQLEngine()

    // Call callback asynchronously
    if (callback) {
      setTimeout(() => callback(null), 0)
    }
  }

  get path(): string {
    return this._path
  }

  get open(): boolean {
    return this._open
  }

  all<T = any>(sql: string, callback?: AllCallback<T>): T[]
  all<T = any>(sql: string, params: any[], callback?: AllCallback<T>): T[]
  all<T = any>(
    sql: string,
    paramsOrCallback?: any[] | AllCallback<T>,
    callback?: AllCallback<T>
  ): T[] {
    this.checkOpen()

    let params: any[] = []
    let cb: AllCallback<T> | undefined

    if (typeof paramsOrCallback === 'function') {
      cb = paramsOrCallback
    } else if (Array.isArray(paramsOrCallback)) {
      params = paramsOrCallback
      cb = callback
    }

    try {
      const result = this.db.execute(sql, params)

      const rows = result.rows.map((row) => {
        const obj: any = {}
        for (let i = 0; i < result.columns.length; i++) {
          obj[result.columns[i]] = row[i]
        }
        return obj as T
      })

      if (cb) {
        setTimeout(() => cb!(null, rows), 0)
      }

      return rows
    } catch (e) {
      if (cb) {
        setTimeout(() => cb!(e as Error, undefined), 0)
        return []
      }
      throw e
    }
  }

  get<T = any>(sql: string, callback?: GetCallback<T>): T | undefined
  get<T = any>(sql: string, params: any[], callback?: GetCallback<T>): T | undefined
  get<T = any>(
    sql: string,
    paramsOrCallback?: any[] | GetCallback<T>,
    callback?: GetCallback<T>
  ): T | undefined {
    this.checkOpen()

    let params: any[] = []
    let cb: GetCallback<T> | undefined

    if (typeof paramsOrCallback === 'function') {
      cb = paramsOrCallback
    } else if (Array.isArray(paramsOrCallback)) {
      params = paramsOrCallback
      cb = callback
    }

    try {
      const rows = this.all<T>(sql, params)
      const row = rows[0]

      if (cb) {
        setTimeout(() => cb!(null, row), 0)
      }

      return row
    } catch (e) {
      if (cb) {
        setTimeout(() => cb!(e as Error, undefined), 0)
        return undefined
      }
      throw e
    }
  }

  run(sql: string, callback?: RunCallback): QueryResult
  run(sql: string, params: any[], callback?: RunCallback): QueryResult
  run(
    sql: string,
    paramsOrCallback?: any[] | RunCallback,
    callback?: RunCallback
  ): QueryResult {
    this.checkOpen()

    let params: any[] = []
    let cb: RunCallback | undefined

    if (typeof paramsOrCallback === 'function') {
      cb = paramsOrCallback
    } else if (Array.isArray(paramsOrCallback)) {
      params = paramsOrCallback
      cb = callback
    }

    try {
      const result = this.db.execute(sql, params)
      const queryResult: QueryResult = {
        changes: result.changes,
        lastInsertRowid: result.lastRowId > 0 ? result.lastRowId : undefined,
      }

      if (cb) {
        setTimeout(() => cb!(null, queryResult), 0)
      }

      return queryResult
    } catch (e) {
      if (cb) {
        setTimeout(() => cb!(e as Error, undefined), 0)
        return { changes: 0 }
      }
      throw e
    }
  }

  each<T = any>(
    sql: string,
    callback: EachRowCallback<T>,
    complete?: EachCompleteCallback
  ): void
  each<T = any>(
    sql: string,
    params: any[],
    callback: EachRowCallback<T>,
    complete?: EachCompleteCallback
  ): void
  each<T = any>(
    sql: string,
    paramsOrCallback: any[] | EachRowCallback<T>,
    callbackOrComplete?: EachRowCallback<T> | EachCompleteCallback,
    complete?: EachCompleteCallback
  ): void {
    this.checkOpen()

    let params: any[] = []
    let rowCallback: EachRowCallback<T>
    let completeCallback: EachCompleteCallback | undefined

    if (typeof paramsOrCallback === 'function') {
      rowCallback = paramsOrCallback
      completeCallback = callbackOrComplete as EachCompleteCallback
    } else {
      params = paramsOrCallback
      rowCallback = callbackOrComplete as EachRowCallback<T>
      completeCallback = complete
    }

    try {
      const rows = this.all<T>(sql, params)

      for (const row of rows) {
        rowCallback(null, row)
      }

      if (completeCallback) {
        completeCallback(null, rows.length)
      }
    } catch (e) {
      if (completeCallback) {
        completeCallback(e as Error, 0)
      }
    }
  }

  prepare(sql: string): IStatement {
    this.checkOpen()
    return new DuckDBStatement(this.db, sql)
  }

  async connect(): Promise<IConnection> {
    this.checkOpen()
    return new DuckDBConnection(this.db)
  }

  close(): Promise<void>
  close(callback: CloseCallback): void
  close(callback?: CloseCallback): void | Promise<void> {
    const doClose = (): Promise<void> => {
      return new Promise((resolve) => {
        this._open = false
        resolve()
      })
    }

    if (callback) {
      doClose()
        .then(() => callback(null))
        .catch((e) => callback(e))
    } else {
      return doClose()
    }
  }

  private checkOpen(): void {
    if (!this._open) {
      throw new DuckDBError('Database is closed', 'INVALID_STATE')
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { DuckDBDatabase as Database }
export { DuckDBConnection as Connection }
export { DuckDBStatement as Statement }
export { DuckDBError }

/**
 * Open database asynchronously
 */
export async function open(
  path: string = ':memory:',
  config?: DatabaseConfig
): Promise<DuckDBDatabase> {
  return new Promise((resolve, reject) => {
    const db = new DuckDBDatabase(path, config, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve(db)
      }
    })
  })
}

/**
 * Default export matching duckdb module structure
 */
export default {
  Database: DuckDBDatabase,
  Connection: DuckDBConnection,
  Statement: DuckDBStatement,
  DuckDBError,
  open,
}
