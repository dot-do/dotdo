/**
 * @dotdo/postgres - PostgreSQL SDK compat
 *
 * Drop-in replacement for pg (node-postgres) backed by DO SQLite.
 * This in-memory implementation matches the pg Client and Pool API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://node-postgres.com/
 */
import type {
  Client as IClient,
  Pool as IPool,
  PoolClient,
  ClientConfig,
  PoolConfig,
  ExtendedPostgresConfig,
  QueryResult,
  QueryConfig,
  FieldDef,
  Notification,
  Connection,
  ConnectionConfig,
} from './types'
import { DatabaseError, ConnectionError, types } from './types'

// ============================================================================
// EVENT EMITTER (minimal implementation)
// ============================================================================

type EventHandler = (...args: any[]) => void

class EventEmitter {
  private handlers = new Map<string, Set<EventHandler>>()

  on(event: string, handler: EventHandler): this {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)
    return this
  }

  off(event: string, handler: EventHandler): this {
    this.handlers.get(event)?.delete(handler)
    return this
  }

  removeListener(event: string, handler: EventHandler): this {
    return this.off(event, handler)
  }

  emit(event: string, ...args: any[]): boolean {
    const handlers = this.handlers.get(event)
    if (!handlers || handlers.size === 0) return false
    for (const handler of handlers) {
      try {
        handler(...args)
      } catch (e) {
        // Emit to error handler if not error event
        if (event !== 'error') {
          this.emit('error', e)
        }
      }
    }
    return true
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.handlers.delete(event)
    } else {
      this.handlers.clear()
    }
    return this
  }
}

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
      // Savepoints not fully implemented, just acknowledge
      return { columns: [], rows: [], rowCount: 0, command: 'SAVEPOINT' }
    }

    if (upperSql.startsWith('RELEASE')) {
      return { columns: [], rows: [], rowCount: 0, command: 'RELEASE' }
    }

    if (upperSql.startsWith('SET ')) {
      // SET commands are no-ops for in-memory
      return { columns: [], rows: [], rowCount: 0, command: 'SET' }
    }

    if (upperSql.startsWith('SHOW ')) {
      return this.executeShow(normalizedSql)
    }

    throw new DatabaseError(`Unsupported SQL: ${sql}`, '42601', 'ERROR')
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

  private executeCreateTable(sql: string): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    // Handle IF NOT EXISTS
    const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(sql)

    // Parse CREATE TABLE name (col1 TYPE, col2 TYPE, ...)
    const match = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))\s*\(([^)]+)\)/i)
    if (!match) {
      throw new DatabaseError('Invalid CREATE TABLE syntax', '42601', 'ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()

    if (this.tables.has(tableName)) {
      if (ifNotExists) {
        return { columns: [], rows: [], rowCount: 0, command: 'CREATE TABLE' }
      }
      throw new DatabaseError(`Table "${tableName}" already exists`, '42P07', 'ERROR')
    }

    const columnDefs = this.splitColumnDefs(match[3])

    const columns: string[] = []
    const columnTypes: string[] = []
    const uniqueConstraints: string[] = []
    let primaryKey: string | undefined
    let autoIncrement: string | undefined

    for (const def of columnDefs) {
      const trimmed = def.trim()

      // Skip constraint definitions
      if (/^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT)/i.test(trimmed)) {
        // Parse inline PRIMARY KEY (col1, col2)
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
    // Indexes are no-op for in-memory
    return { columns: [], rows: [], rowCount: 0, command: 'CREATE INDEX' }
  }

  private executeDropTable(sql: string): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    const match = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))/i)
    if (!match) {
      throw new DatabaseError('Invalid DROP TABLE syntax', '42601', 'ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const ifExists = /IF\s+EXISTS/i.test(sql)

    if (!this.tables.has(tableName)) {
      if (ifExists) {
        return { columns: [], rows: [], rowCount: 0, command: 'DROP TABLE' }
      }
      throw new DatabaseError(`Table "${tableName}" does not exist`, '42P01', 'ERROR')
    }

    this.tables.delete(tableName)
    this.data.delete(tableName)

    return { columns: [], rows: [], rowCount: 0, command: 'DROP TABLE' }
  }

  private executeInsert(sql: string, params: any[]): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    // Parse INSERT INTO table [(cols)] VALUES ($1, $2, ...) [RETURNING ...]
    const match = sql.match(
      /INSERT\s+INTO\s+(?:"([^"]+)"|(\w+))\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([^)]+)\)(?:\s*RETURNING\s+(.+))?/i
    )
    if (!match) {
      throw new DatabaseError('Invalid INSERT syntax', '42601', 'ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new DatabaseError(`Table "${tableName}" does not exist`, '42P01', 'ERROR')
    }

    const specifiedCols = match[3]
      ? match[3].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : schema.columns

    const valuesPart = match[4]
    const returningCols = match[5]
      ? match[5].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : null

    // Parse values - handle $1, $2, etc. or inline values
    const insertValues = this.parseValues(valuesPart, params)

    // Build row values map
    const values = new Map<string, any>()
    for (let i = 0; i < specifiedCols.length; i++) {
      values.set(specifiedCols[i], insertValues[i] ?? null)
    }

    // Handle auto-increment (SERIAL)
    if (schema.autoIncrement && !values.has(schema.autoIncrement)) {
      values.set(schema.autoIncrement, this.lastRowId + 1)
    } else if (schema.autoIncrement && values.get(schema.autoIncrement) === undefined) {
      values.set(schema.autoIncrement, this.lastRowId + 1)
    }

    // Check unique constraints
    const tableData = this.data.get(tableName) ?? []
    for (const constraint of schema.uniqueConstraints) {
      const newValue = values.get(constraint)
      for (const row of tableData) {
        if (row.values.get(constraint) === newValue && newValue !== null && newValue !== undefined) {
          throw new DatabaseError(
            `duplicate key value violates unique constraint "${tableName}_${constraint}_key"`,
            '23505',
            'ERROR'
          )
        }
      }
    }

    const rowid = ++this.lastRowId
    tableData.push({ rowid, values })

    // Handle RETURNING
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

      // Handle $1, $2, etc.
      const paramMatch = trimmed.match(/^\$(\d+)$/)
      if (paramMatch) {
        const index = parseInt(paramMatch[1], 10) - 1
        values.push(params[index])
        continue
      }

      // Handle DEFAULT
      if (trimmed.toUpperCase() === 'DEFAULT') {
        values.push(undefined)
        continue
      }

      // Handle quoted strings
      if (
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
      ) {
        values.push(trimmed.slice(1, -1))
        continue
      }

      // Handle NULL
      if (trimmed.toUpperCase() === 'NULL') {
        values.push(null)
        continue
      }

      // Handle numbers
      if (/^-?\d+$/.test(trimmed)) {
        values.push(parseInt(trimmed, 10))
        continue
      }
      if (/^-?\d+\.\d+$/.test(trimmed)) {
        values.push(parseFloat(trimmed))
        continue
      }

      // Handle booleans
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

    // Handle SELECT 1, SELECT version(), etc.
    if (/SELECT\s+\d+/i.test(normalized) && !/FROM/i.test(normalized)) {
      const match = normalized.match(/SELECT\s+(.+)/i)
      if (match) {
        const expr = match[1].trim()
        if (/^\d+$/.test(expr)) {
          return { columns: ['?column?'], rows: [[parseInt(expr, 10)]], rowCount: 0, command: 'SELECT' }
        }
        if (/^'[^']*'$/.test(expr)) {
          return { columns: ['?column?'], rows: [[expr.slice(1, -1)]], rowCount: 0, command: 'SELECT' }
        }
        // Handle function calls like version()
        return { columns: ['?column?'], rows: [['PostgreSQL 15.0 (dotdo compat)']], rowCount: 0, command: 'SELECT' }
      }
    }

    // Handle SELECT columns FROM table [WHERE ...] [ORDER BY ...] [LIMIT ...]
    // First extract the base parts
    const fromMatch = normalized.match(/SELECT\s+(.+?)\s+FROM\s+(?:"([^"]+)"|(\w+))/i)
    if (!fromMatch) {
      throw new DatabaseError('Invalid SELECT syntax', '42601', 'ERROR')
    }

    const columnsPart = fromMatch[1]
    const mainTable = (fromMatch[2] || fromMatch[3]).toLowerCase()

    // Extract rest of query after the table name
    // Use negative lookahead to avoid matching SQL keywords as table alias
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
      throw new DatabaseError(`Table "${mainTable}" does not exist`, '42P01', 'ERROR')
    }

    let tableData = [...(this.data.get(mainTable) ?? [])]

    // Parse columns
    let selectedColumns: string[]
    if (columnsPart.trim() === '*') {
      selectedColumns = [...schema.columns]
    } else {
      selectedColumns = columnsPart.split(',').map((c) => {
        const col = c.trim()
        // Handle alias.column or just column
        if (col.includes('.')) {
          return col.split('.')[1].replace(/"/g, '').toLowerCase()
        }
        // Handle column AS alias - take the column name
        const asMatch = col.match(/(.+?)\s+AS\s+\w+/i)
        if (asMatch) {
          return asMatch[1].trim().replace(/"/g, '').toLowerCase()
        }
        return col.replace(/"/g, '').toLowerCase()
      })
    }

    // Apply WHERE filter
    const whereMatch = restOfQuery.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+OFFSET|\s*$)/i)
    if (whereMatch) {
      const condition = whereMatch[1].trim()
      tableData = this.applyWhere(tableData, condition, params, tableAlias)
    }

    // Apply ORDER BY
    const orderMatch = restOfQuery.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|\s*$)/i)
    if (orderMatch) {
      const orderBy = orderMatch[1].trim()
      tableData = this.applyOrderBy(tableData, orderBy)
    }

    // Apply LIMIT
    const limitMatch = restOfQuery.match(/LIMIT\s+(\d+)/i)
    if (limitMatch) {
      tableData = tableData.slice(0, parseInt(limitMatch[1], 10))
    }

    // Apply OFFSET
    const offsetMatch = restOfQuery.match(/OFFSET\s+(\d+)/i)
    if (offsetMatch) {
      const offset = parseInt(offsetMatch[1], 10)
      tableData = tableData.slice(offset)
    }

    // Build result
    const rows = tableData.map((row) =>
      selectedColumns.map((col) => row.values.get(col) ?? null)
    )

    return {
      columns: selectedColumns,
      rows,
      rowCount: rows.length,
      command: 'SELECT',
    }
  }

  private applyWhere(data: StoredRow[], condition: string, params: any[], _alias?: string): StoredRow[] {
    // Handle AND conditions
    const andParts = condition.split(/\s+AND\s+/i)
    let result = data

    for (const part of andParts) {
      result = this.applySingleCondition(result, part.trim(), params)
    }

    return result
  }

  private applySingleCondition(data: StoredRow[], condition: string, params: any[]): StoredRow[] {
    // Handle col >= $1 (check before > and =)
    const gteMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*>=\s*(.+)/i)
    if (gteMatch) {
      const colName = gteMatch[1].toLowerCase()
      const valuePart = gteMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => (row.values.get(colName) ?? 0) >= value)
    }

    // Handle col <= $1 (check before < and =)
    const lteMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*<=\s*(.+)/i)
    if (lteMatch) {
      const colName = lteMatch[1].toLowerCase()
      const valuePart = lteMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => (row.values.get(colName) ?? 0) <= value)
    }

    // Handle col != $1 or col <> $1 (check before =)
    const neqMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*(?:!=|<>)\s*(.+)/i)
    if (neqMatch) {
      const colName = neqMatch[1].toLowerCase()
      const valuePart = neqMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => row.values.get(colName) !== value)
    }

    // Handle col > $1 (check before =)
    const gtMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*>\s*(.+)/i)
    if (gtMatch) {
      const colName = gtMatch[1].toLowerCase()
      const valuePart = gtMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => (row.values.get(colName) ?? 0) > value)
    }

    // Handle col < $1 (check before =)
    const ltMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*<\s*(.+)/i)
    if (ltMatch) {
      const colName = ltMatch[1].toLowerCase()
      const valuePart = ltMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
      return data.filter((row) => (row.values.get(colName) ?? 0) < value)
    }

    // Handle col = $1 or col = 'value' or col = value (after all other operators)
    const eqMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s*=\s*(.+)/i)
    if (eqMatch) {
      const colName = eqMatch[1].toLowerCase()
      const valuePart = eqMatch[2].trim()
      const value = this.resolveValue(valuePart, params)
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

    // Handle col LIKE 'pattern'
    const likeMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s+LIKE\s+(.+)/i)
    if (likeMatch) {
      const colName = likeMatch[1].toLowerCase()
      const pattern = this.resolveValue(likeMatch[2].trim(), params) as string
      const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$')
      return data.filter((row) => regex.test(String(row.values.get(colName) ?? '')))
    }

    // Handle col ILIKE 'pattern'
    const ilikeMatch = condition.match(/(?:[\w.]+\.)?(\w+)\s+ILIKE\s+(.+)/i)
    if (ilikeMatch) {
      const colName = ilikeMatch[1].toLowerCase()
      const pattern = this.resolveValue(ilikeMatch[2].trim(), params) as string
      const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i')
      return data.filter((row) => regex.test(String(row.values.get(colName) ?? '')))
    }

    // Handle col IN ($1, $2, ...)
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

  private executeUpdate(sql: string, params: any[]): { columns: string[]; rows: any[][]; rowCount: number; command: string } {
    // Parse UPDATE table SET col1 = $1, col2 = $2 WHERE ...
    const match = sql.match(
      /UPDATE\s+(?:"([^"]+)"|(\w+))\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/i
    )
    if (!match) {
      throw new DatabaseError('Invalid UPDATE syntax', '42601', 'ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const setPart = match[3]
    const wherePart = match[4]
    const returningCols = match[5]
      ? match[5].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : null

    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new DatabaseError(`Table "${tableName}" does not exist`, '42P01', 'ERROR')
    }

    let tableData = this.data.get(tableName) ?? []

    // Apply WHERE filter
    let toUpdate = [...tableData]
    if (wherePart) {
      toUpdate = this.applyWhere(toUpdate, wherePart, params)
    }

    // Parse SET assignments
    const assignments = this.parseSetClause(setPart, params)

    // Apply updates
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
    // Parse DELETE FROM table WHERE ...
    const match = sql.match(
      /DELETE\s+FROM\s+(?:"([^"]+)"|(\w+))(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/i
    )
    if (!match) {
      throw new DatabaseError('Invalid DELETE syntax', '42601', 'ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const wherePart = match[3]
    const returningCols = match[4]
      ? match[4].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : null

    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new DatabaseError(`Table "${tableName}" does not exist`, '42P01', 'ERROR')
    }

    const tableData = this.data.get(tableName) ?? []

    // Find rows to delete
    let toDelete = [...tableData]
    if (wherePart) {
      toDelete = this.applyWhere(toDelete, wherePart, params)
    }

    // Build returning rows before delete
    const deletedRows: any[][] = []
    if (returningCols) {
      for (const row of toDelete) {
        const returnRow = returningCols.includes('*')
          ? schema.columns.map((c) => row.values.get(c))
          : returningCols.map((c) => row.values.get(c))
        deletedRows.push(returnRow)
      }
    }

    // Remove deleted rows
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
    // SHOW commands return dummy values
    return { columns: ['setting'], rows: [['on']], rowCount: 1, command: 'SHOW' }
  }
}

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

class PostgresClient extends EventEmitter implements IClient {
  private db: InMemorySQLite
  private config: ExtendedPostgresConfig
  private connected = false
  private _processID = Math.floor(Math.random() * 100000)
  private _secretKey = Math.floor(Math.random() * 1000000)

  constructor(config?: string | ClientConfig | ExtendedPostgresConfig) {
    super()
    this.config = this.parseConfig(config)
    this.db = new InMemorySQLite()
  }

  private parseConfig(config?: string | ClientConfig | ExtendedPostgresConfig): ExtendedPostgresConfig {
    if (!config) {
      return {}
    }
    if (typeof config === 'string') {
      // Parse connection string
      return { connectionString: config }
    }
    return config as ExtendedPostgresConfig
  }

  get connectionParameters(): ConnectionConfig {
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

  query<R = any, I = any[]>(queryTextOrConfig: string | QueryConfig<I>, values?: I): Promise<QueryResult<R>>
  query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    callback: (err: Error | null, result: QueryResult<R>) => void
  ): void
  query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values: I,
    callback: (err: Error | null, result: QueryResult<R>) => void
  ): void
  query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    valuesOrCallback?: I | ((err: Error | null, result: QueryResult<R>) => void),
    callback?: (err: Error | null, result: QueryResult<R>) => void
  ): void | Promise<QueryResult<R>> {
    let text: string
    let values: any[] = []
    let cb: ((err: Error | null, result: QueryResult<R>) => void) | undefined

    if (typeof queryTextOrConfig === 'string') {
      text = queryTextOrConfig
      if (typeof valuesOrCallback === 'function') {
        cb = valuesOrCallback
      } else if (Array.isArray(valuesOrCallback)) {
        values = valuesOrCallback
        cb = callback
      }
    } else {
      text = queryTextOrConfig.text
      values = queryTextOrConfig.values ?? []
      if (typeof valuesOrCallback === 'function') {
        cb = valuesOrCallback
      }
    }

    const doQuery = (): Promise<QueryResult<R>> => {
      try {
        const result = this.db.execute(text, values)
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

        return Promise.resolve({
          fields,
          rows,
          rowCount: result.rowCount,
          command: result.command,
          oid: 0,
        })
      } catch (e) {
        if (e instanceof DatabaseError) {
          return Promise.reject(e)
        }
        return Promise.reject(new DatabaseError((e as Error).message, '42601'))
      }
    }

    if (cb) {
      doQuery()
        .then((result) => cb!(null, result))
        .catch((err) => cb!(err, null as any))
    } else {
      return doQuery()
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

  copyFrom(_queryText: string): any {
    throw new Error('COPY FROM not supported in in-memory implementation')
  }

  copyTo(_queryText: string): any {
    throw new Error('COPY TO not supported in in-memory implementation')
  }

  pauseDrain(): void {
    // No-op for in-memory
  }

  resumeDrain(): void {
    // No-op for in-memory
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

class PostgresPool extends EventEmitter implements IPool {
  private config: ExtendedPostgresConfig
  private clients: Set<PostgresPoolClient> = new Set()
  private idleClients: PostgresPoolClient[] = []
  private waitingRequests: Array<{
    resolve: (client: PoolClient) => void
    reject: (err: Error) => void
  }> = []
  private _ended = false

  constructor(config?: string | PoolConfig | ExtendedPostgresConfig) {
    super()
    this.config = this.parseConfig(config)
  }

  private parseConfig(config?: string | PoolConfig | ExtendedPostgresConfig): ExtendedPostgresConfig {
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
    } as ExtendedPostgresConfig
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

  async query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: I
  ): Promise<QueryResult<R>> {
    const client = await this.connect()
    try {
      const result = await client.query<R, I>(queryTextOrConfig, values)
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

    // Check for idle client
    if (this.idleClients.length > 0) {
      const client = this.idleClients.pop()!
      this.emit('acquire', client)
      return client
    }

    // Create new client if under max
    const max = this.config.max ?? 10
    if (this.clients.size < max) {
      const client = new PostgresPoolClient(this.config, this)
      this.clients.add(client)
      await client.connect()
      this.emit('connect', client)
      this.emit('acquire', client)
      return client
    }

    // Wait for available client
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

  _releaseClient(client: PostgresPoolClient, destroy?: boolean): void {
    if (destroy) {
      this.clients.delete(client)
      this.emit('remove', client)
      return
    }

    // Check for waiting requests
    if (this.waitingRequests.length > 0) {
      const waiter = this.waitingRequests.shift()!
      this.emit('acquire', client)
      waiter.resolve(client)
      return
    }

    // Return to idle pool
    this.idleClients.push(client)
    this.emit('release', undefined, client)
  }

  async end(): Promise<void> {
    this._ended = true

    // Reject all waiting requests
    for (const waiter of this.waitingRequests) {
      waiter.reject(new ConnectionError('Pool has been ended'))
    }
    this.waitingRequests = []

    // End all clients
    const endPromises: Promise<void>[] = []
    for (const client of this.clients) {
      endPromises.push(client.end())
    }
    await Promise.all(endPromises)

    this.clients.clear()
    this.idleClients = []
  }
}

class PostgresPoolClient extends PostgresClient implements PoolClient {
  private pool: PostgresPool

  constructor(config: ExtendedPostgresConfig, pool: PostgresPool) {
    super(config)
    this.pool = pool
  }

  release(destroy?: boolean): void {
    this.pool._releaseClient(this, destroy)
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { PostgresClient as Client }
export { PostgresPool as Pool }
export { types }
export { DatabaseError, ConnectionError }

/**
 * Create a new native PostgreSQL binding (simulated)
 */
export function native(): { Client: typeof PostgresClient; Pool: typeof PostgresPool } {
  return { Client: PostgresClient, Pool: PostgresPool }
}

/**
 * Default export matching pg module structure
 */
export default {
  Client: PostgresClient,
  Pool: PostgresPool,
  types,
  DatabaseError,
  ConnectionError,
  native,
}
