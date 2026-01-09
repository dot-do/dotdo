/**
 * @dotdo/neon - Neon SDK compat
 *
 * Drop-in replacement for @neondatabase/serverless backed by DO SQLite.
 * This in-memory implementation matches the Neon serverless driver API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://neon.tech/docs/serverless/serverless-driver
 */
import type {
  NeonOptions,
  NeonConfig,
  NeonSqlFunction,
  QueryResult,
  FieldDef,
  PoolConfig,
  ClientConfig,
  PoolClient,
  TransactionCallback,
} from './types'
import { NeonDbError, ConnectionError, types } from './types'
import { EventEmitter } from '../../../../compat/shared/event-emitter'

// ============================================================================
// IN-MEMORY SQLITE (for testing)
// ============================================================================

interface TableSchema {
  name: string
  columns: string[]
  columnTypes: string[]
  primaryKey?: string
  uniqueConstraints: string[]
  autoIncrement?: string
}

interface StoredRow {
  rowid: number
  values: Map<string, any>
}

// Global shared database for all connections
// Each unique connection string gets its own database instance
const dbInstances = new Map<string, InMemorySQLite>()

function getGlobalDb(connectionString?: string): InMemorySQLite {
  // Use a default key for tests without connection string
  const key = connectionString || 'default'

  if (!dbInstances.has(key)) {
    dbInstances.set(key, new InMemorySQLite())
  }
  return dbInstances.get(key)!
}

// For testing: reset all databases or a specific one
export function resetDatabase(connectionString?: string): void {
  if (connectionString) {
    dbInstances.delete(connectionString)
  } else {
    dbInstances.clear()
  }
}

class InMemorySQLite {
  private tables = new Map<string, TableSchema>()
  private data = new Map<string, StoredRow[]>()
  private lastRowId = 0
  private inTransaction = false
  private transactionSnapshot: Map<string, StoredRow[]> | null = null

  execute(sql: string, params: any[] = []): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    const normalizedSql = sql.trim()
    const upperSql = normalizedSql.toUpperCase()

    if (upperSql.startsWith('CREATE TABLE')) {
      return this.executeCreateTable(normalizedSql)
    }

    if (upperSql.startsWith('CREATE INDEX') || upperSql.startsWith('CREATE UNIQUE INDEX')) {
      return this.executeCreateIndex(normalizedSql)
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

    if (upperSql.startsWith('BEGIN') || upperSql === 'START TRANSACTION') {
      return this.executeBegin()
    }

    if (upperSql.startsWith('COMMIT')) {
      return this.executeCommit()
    }

    if (upperSql.startsWith('ROLLBACK')) {
      return this.executeRollback()
    }

    if (upperSql.startsWith('SAVEPOINT')) {
      return { columns: [], rows: [], rowCount: 0, command: 'SAVEPOINT' }
    }

    if (upperSql.startsWith('RELEASE')) {
      return { columns: [], rows: [], rowCount: 0, command: 'RELEASE' }
    }

    if (upperSql.startsWith('SET ')) {
      return { columns: [], rows: [], rowCount: 0, command: 'SET' }
    }

    if (upperSql.startsWith('SHOW ')) {
      return this.executeShow(normalizedSql)
    }

    throw new NeonDbError(`Unsupported SQL: ${sql}`, '42601', 'ERROR')
  }

  beginTransaction(): void {
    this.inTransaction = true
    this.transactionSnapshot = new Map()
    for (const [table, rows] of this.data) {
      this.transactionSnapshot.set(
        table,
        rows.map((r) => ({ rowid: r.rowid, values: new Map(r.values) }))
      )
    }
  }

  commitTransaction(): void {
    this.inTransaction = false
    this.transactionSnapshot = null
  }

  rollbackTransaction(): void {
    if (this.transactionSnapshot) {
      this.data = this.transactionSnapshot
    }
    this.inTransaction = false
    this.transactionSnapshot = null
  }

  get isInTransaction(): boolean {
    return this.inTransaction
  }

  private executeCreateTable(sql: string): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(sql)
    const match = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))\s*\(([^)]+)\)/i)
    if (!match) {
      throw new NeonDbError('Invalid CREATE TABLE syntax', '42601', 'ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const columnDefs = this.splitColumnDefs(match[3])

    // Parse new columns first to check for schema mismatch
    const newColumns: string[] = []
    for (const def of columnDefs) {
      const trimmed = def.trim()
      if (/^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT)/i.test(trimmed)) {
        continue
      }
      const parts = trimmed.split(/\s+/)
      const colName = parts[0].replace(/"/g, '').toLowerCase()
      newColumns.push(colName)
    }

    if (this.tables.has(tableName)) {
      if (ifNotExists) {
        // For testing convenience: if table exists with different columns, drop and recreate
        const existingSchema = this.tables.get(tableName)!
        const columnsMatch =
          existingSchema.columns.length === newColumns.length &&
          existingSchema.columns.every((col) => newColumns.includes(col))

        if (columnsMatch) {
          return { columns: [], rows: [], rowCount: 0, command: 'CREATE TABLE' }
        }

        // Schema mismatch - drop and recreate for testing convenience
        this.tables.delete(tableName)
        this.data.delete(tableName)
      } else {
        throw new NeonDbError(`Table "${tableName}" already exists`, '42P07', 'ERROR')
      }
    }

    const columns: string[] = []
    const columnTypes: string[] = []
    const uniqueConstraints: string[] = []
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
      const colType = parts[1]?.toUpperCase() ?? 'TEXT'

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
      if (upperDef.includes('SERIAL') || upperDef.includes('BIGSERIAL')) {
        autoIncrement = colName
        if (!primaryKey) primaryKey = colName
      }
    }

    this.tables.set(tableName, {
      name: tableName,
      columns,
      columnTypes,
      primaryKey,
      uniqueConstraints,
      autoIncrement,
    })
    this.data.set(tableName, [])

    return { columns: [], rows: [], rowCount: 0, command: 'CREATE TABLE' }
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

  private executeCreateIndex(_sql: string): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    return { columns: [], rows: [], rowCount: 0, command: 'CREATE INDEX' }
  }

  private executeDropTable(sql: string): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    const match = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))/i)
    if (!match) {
      throw new NeonDbError('Invalid DROP TABLE syntax', '42601', 'ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const ifExists = /IF\s+EXISTS/i.test(sql)

    if (!this.tables.has(tableName)) {
      if (ifExists) {
        return { columns: [], rows: [], rowCount: 0, command: 'DROP TABLE' }
      }
      throw new NeonDbError(`Table "${tableName}" does not exist`, '42P01', 'ERROR')
    }

    this.tables.delete(tableName)
    this.data.delete(tableName)

    return { columns: [], rows: [], rowCount: 0, command: 'DROP TABLE' }
  }

  private executeInsert(sql: string, params: any[]): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    const match = sql.match(
      /INSERT\s+INTO\s+(?:"([^"]+)"|(\w+))\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([^)]+)\)(?:\s*RETURNING\s+(.+))?/i
    )
    if (!match) {
      throw new NeonDbError('Invalid INSERT syntax', '42601', 'ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new NeonDbError(`Table "${tableName}" does not exist`, '42P01', 'ERROR')
    }

    const specifiedCols = match[3]
      ? match[3].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : schema.columns

    const valuesPart = match[4]
    const returningCols = match[5]
      ? match[5].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : null

    const insertValues = this.parseValues(valuesPart, params)

    const values = new Map<string, any>()
    for (let i = 0; i < specifiedCols.length; i++) {
      values.set(specifiedCols[i], insertValues[i] ?? null)
    }

    if (schema.autoIncrement && !values.has(schema.autoIncrement)) {
      values.set(schema.autoIncrement, this.lastRowId + 1)
    } else if (schema.autoIncrement && values.get(schema.autoIncrement) === undefined) {
      values.set(schema.autoIncrement, this.lastRowId + 1)
    }

    const tableData = this.data.get(tableName) ?? []
    for (const constraint of schema.uniqueConstraints) {
      const newValue = values.get(constraint)
      for (const row of tableData) {
        if (row.values.get(constraint) === newValue && newValue !== null && newValue !== undefined) {
          throw new NeonDbError(
            `duplicate key value violates unique constraint "${tableName}_${constraint}_key"`,
            '23505',
            'ERROR'
          )
        }
      }
    }

    const rowid = ++this.lastRowId
    tableData.push({ rowid, values })

    if (returningCols) {
      const returnRow: any[] = []
      for (const col of returningCols) {
        if (col === '*') {
          returnRow.push(...schema.columns.map((c) => values.get(c)))
        } else {
          returnRow.push(values.get(col))
        }
      }
      return {
        columns: returningCols.includes('*') ? schema.columns : returningCols,
        rows: [returnRow],
        rowCount: 1,
        command: 'INSERT',
      }
    }

    return { columns: [], rows: [], rowCount: 1, command: 'INSERT' }
  }

  private parseValues(valuesPart: string, params: any[]): any[] {
    const values: any[] = []
    const parts = this.splitValues(valuesPart)

    for (const part of parts) {
      const trimmed = part.trim()

      const paramMatch = trimmed.match(/^\$(\d+)$/)
      if (paramMatch) {
        const index = parseInt(paramMatch[1], 10) - 1
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

  private executeSelect(sql: string, params: any[]): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (/SELECT\s+\d+/i.test(normalized) && !/FROM/i.test(normalized)) {
      const match = normalized.match(/SELECT\s+(.+?)(?:\s+as\s+(\w+))?$/i)
      if (match) {
        const expr = match[1].trim()
        const alias = match[2] || '?column?'
        if (/^\d+$/.test(expr)) {
          return { columns: [alias], rows: [[parseInt(expr, 10)]], rowCount: 0, command: 'SELECT' }
        }
        if (/^'[^']*'$/.test(expr)) {
          return { columns: [alias], rows: [[expr.slice(1, -1)]], rowCount: 0, command: 'SELECT' }
        }
        return { columns: [alias], rows: [['PostgreSQL 15.0 (dotdo compat)']], rowCount: 0, command: 'SELECT' }
      }
    }

    const fromMatch = normalized.match(/SELECT\s+(.+?)\s+FROM\s+(?:"([^"]+)"|(\w+))/i)
    if (!fromMatch) {
      throw new NeonDbError('Invalid SELECT syntax', '42601', 'ERROR')
    }

    const columnsPart = fromMatch[1]
    const mainTable = (fromMatch[2] || fromMatch[3]).toLowerCase()

    const sqlKeywords = 'WHERE|ORDER|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|GROUP|HAVING|UNION'
    const afterTablePattern = new RegExp(
      `FROM\\s+(?:"${mainTable}"|${mainTable})(?:\\s+(?:AS\\s+)?(?!${sqlKeywords}\\b)(\\w+))?(.*)$`,
      'i'
    )
    const afterTableMatch = normalized.match(afterTablePattern)
    const tableAlias = afterTableMatch?.[1]?.toLowerCase()
    const restOfQuery = afterTableMatch?.[2]?.trim() ?? ''

    const schema = this.tables.get(mainTable)
    if (!schema) {
      throw new NeonDbError(`Table "${mainTable}" does not exist`, '42P01', 'ERROR')
    }

    let tableData = [...(this.data.get(mainTable) ?? [])]

    let selectedColumns: string[]
    if (columnsPart.trim() === '*') {
      selectedColumns = [...schema.columns]
    } else {
      selectedColumns = columnsPart.split(',').map((c) => {
        const col = c.trim()
        if (col.includes('.')) {
          return col.split('.')[1].replace(/"/g, '').toLowerCase()
        }
        const asMatch = col.match(/(.+?)\s+AS\s+(\w+)/i)
        if (asMatch) {
          return asMatch[2].trim().toLowerCase()
        }
        return col.replace(/"/g, '').toLowerCase()
      })
    }

    const whereMatch = restOfQuery.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+OFFSET|\s*$)/i)
    if (whereMatch) {
      const condition = whereMatch[1].trim()
      tableData = this.applyWhere(tableData, condition, params, tableAlias)
    }

    const orderMatch = restOfQuery.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|\s*$)/i)
    if (orderMatch) {
      const orderBy = orderMatch[1].trim()
      tableData = this.applyOrderBy(tableData, orderBy)
    }

    const limitMatch = restOfQuery.match(/LIMIT\s+(\d+)/i)
    if (limitMatch) {
      tableData = tableData.slice(0, parseInt(limitMatch[1], 10))
    }

    const offsetMatch = restOfQuery.match(/OFFSET\s+(\d+)/i)
    if (offsetMatch) {
      const offset = parseInt(offsetMatch[1], 10)
      tableData = tableData.slice(offset)
    }

    // Get actual columns for rows
    const actualColumns = columnsPart.trim() === '*' ? schema.columns : columnsPart.split(',').map((c) => {
      const col = c.trim()
      if (col.includes('.')) {
        return col.split('.')[1].replace(/"/g, '').toLowerCase()
      }
      const asMatch = col.match(/(.+?)\s+AS\s+\w+/i)
      if (asMatch) {
        return asMatch[1].trim().replace(/"/g, '').toLowerCase()
      }
      return col.replace(/"/g, '').toLowerCase()
    })

    const rows = tableData.map((row) =>
      actualColumns.map((col) => row.values.get(col) ?? null)
    )

    return {
      columns: selectedColumns,
      rows,
      rowCount: rows.length,
      command: 'SELECT',
    }
  }

  private applyWhere(data: StoredRow[], condition: string, params: any[], _alias?: string): StoredRow[] {
    const andParts = condition.split(/\s+AND\s+/i)
    let result = data

    for (const part of andParts) {
      result = this.applySingleCondition(result, part.trim(), params)
    }

    return result
  }

  private applySingleCondition(data: StoredRow[], condition: string, params: any[]): StoredRow[] {
    const gteMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*>=\s*(.+)/i)
    if (gteMatch) {
      const colName = gteMatch[1].toLowerCase()
      const valuePart = gteMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => (row.values.get(colName) ?? 0) >= value)
    }

    const lteMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*<=\s*(.+)/i)
    if (lteMatch) {
      const colName = lteMatch[1].toLowerCase()
      const valuePart = lteMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => (row.values.get(colName) ?? 0) <= value)
    }

    const neqMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*(?:!=|<>)\s*(.+)/i)
    if (neqMatch) {
      const colName = neqMatch[1].toLowerCase()
      const valuePart = neqMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => row.values.get(colName) !== value)
    }

    const gtMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*>\s*(.+)/i)
    if (gtMatch) {
      const colName = gtMatch[1].toLowerCase()
      const valuePart = gtMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => (row.values.get(colName) ?? 0) > value)
    }

    const ltMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*<\s*(.+)/i)
    if (ltMatch) {
      const colName = ltMatch[1].toLowerCase()
      const valuePart = ltMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => (row.values.get(colName) ?? 0) < value)
    }

    const eqMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*=\s*(.+)/i)
    if (eqMatch) {
      const colName = eqMatch[1].toLowerCase()
      const valuePart = eqMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => row.values.get(colName) === value)
    }

    const isNullMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s+IS\s+NULL/i)
    if (isNullMatch) {
      const colName = isNullMatch[1].toLowerCase()
      return data.filter((row) => row.values.get(colName) === null)
    }

    const isNotNullMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s+IS\s+NOT\s+NULL/i)
    if (isNotNullMatch) {
      const colName = isNotNullMatch[1].toLowerCase()
      return data.filter((row) => row.values.get(colName) !== null)
    }

    const likeMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s+LIKE\s+(.+)/i)
    if (likeMatch) {
      const colName = likeMatch[1].toLowerCase()
      const pattern = this.resolveValue(likeMatch[2].trim(), params) as string
      const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$')
      return data.filter((row) => regex.test(String(row.values.get(colName) ?? '')))
    }

    const ilikeMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s+ILIKE\s+(.+)/i)
    if (ilikeMatch) {
      const colName = ilikeMatch[1].toLowerCase()
      const pattern = this.resolveValue(ilikeMatch[2].trim(), params) as string
      const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i')
      return data.filter((row) => regex.test(String(row.values.get(colName) ?? '')))
    }

    const inMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s+IN\s*\(([^)]+)\)/i)
    if (inMatch) {
      const colName = inMatch[1].toLowerCase()
      const valuesPart = inMatch[2]
      const values = valuesPart.split(',').map((v) => this.resolveValue(v.trim(), params))
      return data.filter((row) => values.includes(row.values.get(colName)))
    }

    return data
  }

  private resolveValue(valuePart: string, params: any[]): any {
    const paramMatch = valuePart.match(/^\$(\d+)$/)
    if (paramMatch) {
      return params[parseInt(paramMatch[1], 10) - 1]
    }

    if (
      (valuePart.startsWith("'") && valuePart.endsWith("'")) ||
      (valuePart.startsWith('"') && valuePart.endsWith('"'))
    ) {
      return valuePart.slice(1, -1)
    }

    if (valuePart.toUpperCase() === 'NULL') {
      return null
    }

    if (valuePart.toUpperCase() === 'TRUE') return true
    if (valuePart.toUpperCase() === 'FALSE') return false

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

  private executeUpdate(sql: string, params: any[]): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    const match = sql.match(
      /UPDATE\s+(?:"([^"]+)"|(\w+))\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/i
    )
    if (!match) {
      throw new NeonDbError('Invalid UPDATE syntax', '42601', 'ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const setPart = match[3]
    const wherePart = match[4]
    const returningCols = match[5]
      ? match[5].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : null

    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new NeonDbError(`Table "${tableName}" does not exist`, '42P01', 'ERROR')
    }

    let tableData = this.data.get(tableName) ?? []

    let toUpdate = [...tableData]
    if (wherePart) {
      toUpdate = this.applyWhere(toUpdate, wherePart, params)
    }

    const assignments = this.parseSetClause(setPart, params)

    const updatedRows: any[][] = []
    for (const row of toUpdate) {
      for (const [col, value] of assignments) {
        row.values.set(col, value)
      }
      if (returningCols) {
        const returnRow = returningCols.includes('*')
          ? schema.columns.map((c) => row.values.get(c))
          : returningCols.map((c) => row.values.get(c))
        updatedRows.push(returnRow)
      }
    }

    if (returningCols) {
      return {
        columns: returningCols.includes('*') ? schema.columns : returningCols,
        rows: updatedRows,
        rowCount: toUpdate.length,
        command: 'UPDATE',
      }
    }

    return { columns: [], rows: [], rowCount: toUpdate.length, command: 'UPDATE' }
  }

  private parseSetClause(setPart: string, params: any[]): Map<string, any> {
    const assignments = new Map<string, any>()
    const parts = this.splitValues(setPart)

    for (const part of parts) {
      const match = part.match(/(?:"([^"]+)"|(\w+))\s*=\s*(.+)/i)
      if (match) {
        const col = (match[1] || match[2]).toLowerCase()
        const value = this.resolveValue(match[3].trim(), params)
        assignments.set(col, value)
      }
    }

    return assignments
  }

  private executeDelete(sql: string, params: any[]): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    const match = sql.match(
      /DELETE\s+FROM\s+(?:"([^"]+)"|(\w+))(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/i
    )
    if (!match) {
      throw new NeonDbError('Invalid DELETE syntax', '42601', 'ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const wherePart = match[3]
    const returningCols = match[4]
      ? match[4].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : null

    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new NeonDbError(`Table "${tableName}" does not exist`, '42P01', 'ERROR')
    }

    const tableData = this.data.get(tableName) ?? []

    let toDelete = [...tableData]
    if (wherePart) {
      toDelete = this.applyWhere(toDelete, wherePart, params)
    }

    const deletedRows: any[][] = []
    if (returningCols) {
      for (const row of toDelete) {
        const returnRow = returningCols.includes('*')
          ? schema.columns.map((c) => row.values.get(c))
          : returningCols.map((c) => row.values.get(c))
        deletedRows.push(returnRow)
      }
    }

    const toDeleteRowIds = new Set(toDelete.map((r) => r.rowid))
    this.data.set(
      tableName,
      tableData.filter((r) => !toDeleteRowIds.has(r.rowid))
    )

    if (returningCols) {
      return {
        columns: returningCols.includes('*') ? schema.columns : returningCols,
        rows: deletedRows,
        rowCount: toDelete.length,
        command: 'DELETE',
      }
    }

    return { columns: [], rows: [], rowCount: toDelete.length, command: 'DELETE' }
  }

  private executeBegin(): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    this.beginTransaction()
    return { columns: [], rows: [], rowCount: 0, command: 'BEGIN' }
  }

  private executeCommit(): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    this.commitTransaction()
    return { columns: [], rows: [], rowCount: 0, command: 'COMMIT' }
  }

  private executeRollback(): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    this.rollbackTransaction()
    return { columns: [], rows: [], rowCount: 0, command: 'ROLLBACK' }
  }

  private executeShow(_sql: string): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    return { columns: ['setting'], rows: [['on']], rowCount: 1, command: 'SHOW' }
  }
}

// ============================================================================
// NEON CONFIG
// ============================================================================

export const neonConfig: NeonConfig = {
  fetchConnectionCache: false,
  poolQueryViaFetch: false,
  fetchEndpoint: undefined,
  wsProxy: undefined,
  useSecureWebSocket: true,
  pipelineConnect: 'password',
  coalesceWrites: true,
}

// ============================================================================
// NEON SQL FUNCTION
// ============================================================================

/**
 * Create a SQL function for executing queries via HTTP
 */
export function neon(connectionString: string, options?: NeonOptions): NeonSqlFunction {
  const db = getGlobalDb(connectionString)
  const fullResults = options?.fullResults ?? false
  const arrayMode = options?.arrayMode ?? false

  // SQL template tag and function call handler
  function sql(stringsOrText: TemplateStringsArray | string, ...valuesOrParams: any[]): Promise<any> {
    let text: string
    let params: any[]

    if (typeof stringsOrText === 'string') {
      // Called as sql('SELECT ...', [params])
      text = stringsOrText
      params = valuesOrParams[0] ?? []
    } else {
      // Called as sql`SELECT ...`
      const strings = stringsOrText as TemplateStringsArray
      text = strings[0]
      params = []

      for (let i = 0; i < valuesOrParams.length; i++) {
        params.push(valuesOrParams[i])
        text += `$${i + 1}${strings[i + 1]}`
      }
    }

    return executeQuery(db, text, params, fullResults, arrayMode)
  }

  // Add transaction support
  sql.transaction = async function <T = any>(
    queriesOrCallback: Promise<any>[] | TransactionCallback<T>
  ): Promise<any> {
    if (typeof queriesOrCallback === 'function') {
      // Callback style transaction
      const callback = queriesOrCallback as TransactionCallback<T>
      db.beginTransaction()
      try {
        const result = await callback(sql as NeonSqlFunction)
        db.commitTransaction()
        return result
      } catch (e) {
        db.rollbackTransaction()
        throw e
      }
    } else {
      // Array of queries style
      const queries = queriesOrCallback as Promise<any>[]
      db.beginTransaction()
      try {
        const results = await Promise.all(queries)
        db.commitTransaction()
        return results
      } catch (e) {
        db.rollbackTransaction()
        throw e
      }
    }
  }

  return sql as NeonSqlFunction
}

async function executeQuery(
  db: InMemorySQLite,
  text: string,
  params: any[],
  fullResults: boolean,
  arrayMode: boolean
): Promise<any> {
  try {
    const result = db.execute(text, params)
    const fields: FieldDef[] = result.columns.map((name, i) => ({
      name,
      tableID: 0,
      columnID: i,
      dataTypeID: types.TEXT,
      dataTypeSize: -1,
      dataTypeModifier: -1,
      format: 'text',
    }))

    if (arrayMode) {
      // Return rows as arrays
      if (fullResults) {
        return {
          fields,
          rows: result.rows,
          rowCount: result.rowCount,
          command: result.command,
          oid: 0,
        }
      }
      return result.rows
    }

    // Convert rows to objects
    const rows = result.rows.map((row) => {
      const obj: any = {}
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i]] = row[i]
      }
      return obj
    })

    if (fullResults) {
      return {
        fields,
        rows,
        rowCount: result.rowCount,
        command: result.command,
        oid: 0,
      }
    }

    return rows
  } catch (e) {
    if (e instanceof NeonDbError) {
      throw e
    }
    throw new NeonDbError((e as Error).message, '42601')
  }
}

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

export class NeonClient extends EventEmitter {
  private db: InMemorySQLite
  private config: ClientConfig
  private connected = false
  private _processID = Math.floor(Math.random() * 100000)
  private _secretKey = Math.floor(Math.random() * 1000000)

  constructor(config?: string | ClientConfig) {
    super()
    this.config = this.parseConfig(config)
    this.db = getGlobalDb()
  }

  private parseConfig(config?: string | ClientConfig): ClientConfig {
    if (!config) {
      return {}
    }
    if (typeof config === 'string') {
      return { connectionString: config }
    }
    return config
  }

  get connectionParameters(): ClientConfig {
    return this.config
  }

  get processID(): number | null {
    return this.connected ? this._processID : null
  }

  get secretKey(): number | null {
    return this.connected ? this._secretKey : null
  }

  connect(): Promise<void>
  connect(callback: (err?: Error) => void): void
  connect(callback?: (err?: Error) => void): void | Promise<void> {
    const doConnect = (): Promise<void> => {
      return new Promise((resolve) => {
        this.connected = true
        this.emit('connect')
        resolve()
      })
    }

    if (callback) {
      doConnect()
        .then(() => callback())
        .catch(callback)
    } else {
      return doConnect()
    }
  }

  async query<R = any>(text: string, values?: any[]): Promise<QueryResult<R>> {
    try {
      const result = this.db.execute(text, values ?? [])
      const fields: FieldDef[] = result.columns.map((name, i) => ({
        name,
        tableID: 0,
        columnID: i,
        dataTypeID: types.TEXT,
        dataTypeSize: -1,
        dataTypeModifier: -1,
        format: 'text',
      }))

      const rows = result.rows.map((row) => {
        const obj: any = {}
        for (let i = 0; i < result.columns.length; i++) {
          obj[result.columns[i]] = row[i]
        }
        return obj as R
      })

      return {
        fields,
        rows,
        rowCount: result.rowCount,
        command: result.command,
        oid: 0,
      }
    } catch (e) {
      if (e instanceof NeonDbError) {
        throw e
      }
      throw new NeonDbError((e as Error).message, '42601')
    }
  }

  end(): Promise<void>
  end(callback: (err?: Error) => void): void
  end(callback?: (err?: Error) => void): void | Promise<void> {
    const doEnd = (): Promise<void> => {
      return new Promise((resolve) => {
        this.connected = false
        this.emit('end')
        resolve()
      })
    }

    if (callback) {
      doEnd()
        .then(() => callback())
        .catch(callback)
    } else {
      return doEnd()
    }
  }

  escapeLiteral(value: string): string {
    return "'" + value.replace(/'/g, "''") + "'"
  }

  escapeIdentifier(value: string): string {
    return '"' + value.replace(/"/g, '""') + '"'
  }
}

// ============================================================================
// POOL IMPLEMENTATION
// ============================================================================

class NeonPoolClient extends NeonClient implements PoolClient {
  private pool: NeonPool

  constructor(config: ClientConfig, pool: NeonPool) {
    super(config)
    this.pool = pool
  }

  release(destroy?: boolean): void {
    this.pool._releaseClient(this, destroy)
  }
}

export class NeonPool extends EventEmitter {
  private config: PoolConfig
  private clients: Set<NeonPoolClient> = new Set()
  private idleClients: NeonPoolClient[] = []
  private waitingRequests: Array<{
    resolve: (client: PoolClient) => void
    reject: (err: Error) => void
  }> = []
  private _ended = false

  constructor(config?: string | PoolConfig) {
    super()
    this.config = this.parseConfig(config)
  }

  private parseConfig(config?: string | PoolConfig): PoolConfig {
    if (!config) {
      return { max: 10, min: 0, idleTimeoutMillis: 10000 }
    }
    if (typeof config === 'string') {
      return { connectionString: config, max: 10, min: 0, idleTimeoutMillis: 10000 }
    }
    return {
      max: 10,
      min: 0,
      idleTimeoutMillis: 10000,
      ...config,
    }
  }

  get totalCount(): number {
    return this.clients.size
  }

  get idleCount(): number {
    return this.idleClients.length
  }

  get waitingCount(): number {
    return this.waitingRequests.length
  }

  get ended(): boolean {
    return this._ended
  }

  async query<R = any>(text: string, values?: any[]): Promise<QueryResult<R>> {
    const client = await this.connect()
    try {
      const result = await client.query<R>(text, values)
      client.release()
      return result
    } catch (e) {
      client.release(true)
      throw e
    }
  }

  async connect(): Promise<PoolClient> {
    if (this._ended) {
      throw new ConnectionError('Pool has been ended')
    }

    if (this.idleClients.length > 0) {
      const client = this.idleClients.pop()!
      this.emit('acquire', client)
      return client
    }

    const max = this.config.max ?? 10
    if (this.clients.size < max) {
      const client = new NeonPoolClient(this.config, this)
      this.clients.add(client)
      await client.connect()
      this.emit('connect', client)
      this.emit('acquire', client)
      return client
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.connectionTimeoutMillis ?? 30000
      const timer = setTimeout(() => {
        const index = this.waitingRequests.findIndex(
          (r) => r.resolve === resolve && r.reject === reject
        )
        if (index >= 0) {
          this.waitingRequests.splice(index, 1)
        }
        reject(new ConnectionError('Connection timeout'))
      }, timeoutMs)

      this.waitingRequests.push({
        resolve: (client) => {
          clearTimeout(timer)
          resolve(client)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
    })
  }

  _releaseClient(client: NeonPoolClient, destroy?: boolean): void {
    if (destroy) {
      this.clients.delete(client)
      this.emit('remove', client)
      return
    }

    if (this.waitingRequests.length > 0) {
      const waiter = this.waitingRequests.shift()!
      this.emit('acquire', client)
      waiter.resolve(client)
      return
    }

    this.idleClients.push(client)
    this.emit('release', undefined, client)
  }

  async end(): Promise<void> {
    this._ended = true

    for (const waiter of this.waitingRequests) {
      waiter.reject(new ConnectionError('Pool has been ended'))
    }
    this.waitingRequests = []

    const endPromises: Promise<void>[] = []
    for (const client of this.clients) {
      endPromises.push(client.end())
    }
    await Promise.all(endPromises)

    this.clients.clear()
    this.idleClients = []
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { NeonClient as Client }
export { NeonPool as Pool }
export { types }
export { NeonDbError, ConnectionError }
