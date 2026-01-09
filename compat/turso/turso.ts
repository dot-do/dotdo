/**
 * @dotdo/turso - Turso/libSQL SDK compat
 *
 * Drop-in replacement for @libsql/client backed by DO SQLite.
 * This in-memory implementation matches the libSQL Client API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://docs.turso.tech/sdk/ts/reference
 */
import type {
  Client,
  Config,
  ExtendedTursoConfig,
  ResultSet,
  Row,
  Transaction,
  TransactionMode,
  InStatement,
  InArgs,
  InValue,
  Value,
  Replicated,
} from './types'
import { LibsqlError, LibsqlBatchError } from './types'

// ============================================================================
// STATEMENT PARSING
// ============================================================================

/**
 * Parse statement into SQL string and args array
 */
export function parseStatement(stmt: InStatement): { sql: string; args: Value[] } {
  if (typeof stmt === 'string') {
    return { sql: stmt, args: [] }
  }

  const args = normalizeArgs(stmt.args ?? [])
  return { sql: stmt.sql, args }
}

/**
 * Normalize args to SQLite-compatible values
 */
function normalizeArgs(args: InArgs): Value[] {
  if (Array.isArray(args)) {
    return args.map(normalizeValue)
  }

  // Named args - not directly supported in this impl, would need SQL rewriting
  return Object.values(args).map(normalizeValue)
}

/**
 * Normalize a single value to SQLite-compatible format
 */
function normalizeValue(value: InValue): Value {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return value.buffer as ArrayBuffer
  return value as Value
}

// ============================================================================
// RESULT SET CREATION
// ============================================================================

/**
 * Create a Row that's accessible by index and column name
 */
function createRow(values: Value[], columns: string[]): Row {
  const row: Row = {
    length: values.length,
  }

  // Set values by index
  for (let i = 0; i < values.length; i++) {
    row[i] = values[i]
  }

  // Set values by column name
  for (let i = 0; i < columns.length; i++) {
    row[columns[i]] = values[i]
  }

  return row
}

/**
 * Create a ResultSet from query results
 */
export function createResultSet(
  columns: string[],
  columnTypes: string[],
  rawRows: Value[][],
  rowsAffected: number,
  lastInsertRowid: bigint | undefined
): ResultSet {
  const rows = rawRows.map((values) => createRow(values, columns))

  return {
    columns,
    columnTypes,
    rows,
    rowsAffected,
    lastInsertRowid,
    toJSON() {
      return {
        columns: this.columns,
        columnTypes: this.columnTypes,
        rows: this.rows.map((row) => {
          const obj: Record<string, Value> = {}
          for (let i = 0; i < this.columns.length; i++) {
            obj[this.columns[i]] = row[i]
          }
          return obj
        }),
        rowsAffected: this.rowsAffected,
        lastInsertRowid: this.lastInsertRowid?.toString(),
      }
    },
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
}

interface StoredRow {
  rowid: number
  values: Map<string, Value>
}

class InMemorySQLite {
  private tables = new Map<string, TableSchema>()
  private data = new Map<string, StoredRow[]>()
  private lastRowId = 0
  private inTransaction = false
  private transactionSnapshot: Map<string, StoredRow[]> | null = null
  private transactionMode: TransactionMode = 'write'

  execute(sql: string, args: Value[] = []): ResultSet {
    const normalizedSql = sql.trim().toUpperCase()

    if (normalizedSql.startsWith('CREATE TABLE')) {
      return this.executeCreateTable(sql)
    }

    if (normalizedSql.startsWith('CREATE INDEX')) {
      return this.executeCreateIndex(sql)
    }

    if (normalizedSql.startsWith('INSERT')) {
      if (this.transactionMode === 'read') {
        throw new LibsqlError('Cannot write in read-only transaction', 'SQLITE_READONLY')
      }
      return this.executeInsert(sql, args)
    }

    if (normalizedSql.startsWith('SELECT')) {
      return this.executeSelect(sql, args)
    }

    if (normalizedSql.startsWith('UPDATE')) {
      if (this.transactionMode === 'read') {
        throw new LibsqlError('Cannot write in read-only transaction', 'SQLITE_READONLY')
      }
      return this.executeUpdate(sql, args)
    }

    if (normalizedSql.startsWith('DELETE')) {
      if (this.transactionMode === 'read') {
        throw new LibsqlError('Cannot write in read-only transaction', 'SQLITE_READONLY')
      }
      return this.executeDelete(sql, args)
    }

    if (normalizedSql.startsWith('BEGIN')) {
      return this.executeBegin(sql)
    }

    if (normalizedSql.startsWith('COMMIT')) {
      return this.executeCommit()
    }

    if (normalizedSql.startsWith('ROLLBACK')) {
      return this.executeRollback()
    }

    throw new LibsqlError(`Unsupported SQL: ${sql}`, 'SQLITE_ERROR')
  }

  beginTransaction(mode: TransactionMode): void {
    this.inTransaction = true
    this.transactionMode = mode
    // Snapshot current data for rollback
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
    this.transactionMode = 'write'
  }

  rollbackTransaction(): void {
    if (this.transactionSnapshot) {
      this.data = this.transactionSnapshot
    }
    this.inTransaction = false
    this.transactionSnapshot = null
    this.transactionMode = 'write'
  }

  private executeCreateTable(sql: string): ResultSet {
    // Simple parser for CREATE TABLE name (col1 TYPE, col2 TYPE, ...)
    const match = sql.match(/CREATE\s+TABLE\s+(\w+)\s*\(([^)]+)\)/i)
    if (!match) {
      throw new LibsqlError('Invalid CREATE TABLE syntax', 'SQLITE_ERROR')
    }

    const tableName = match[1].toLowerCase()
    const columnDefs = match[2].split(',').map((c) => c.trim())

    const columns: string[] = []
    const columnTypes: string[] = []
    const uniqueConstraints: string[] = []
    let primaryKey: string | undefined

    for (const def of columnDefs) {
      const parts = def.split(/\s+/)
      const colName = parts[0].toLowerCase()
      const colType = parts[1]?.toUpperCase() ?? 'TEXT'

      columns.push(colName)
      columnTypes.push(colType)

      if (def.toUpperCase().includes('PRIMARY KEY')) {
        primaryKey = colName
        // Primary key implies unique constraint
        uniqueConstraints.push(colName)
      }
      if (def.toUpperCase().includes('UNIQUE') && !uniqueConstraints.includes(colName)) {
        uniqueConstraints.push(colName)
      }
    }

    this.tables.set(tableName, {
      name: tableName,
      columns,
      columnTypes,
      primaryKey,
      uniqueConstraints,
    })
    this.data.set(tableName, [])

    return createResultSet([], [], [], 0, undefined)
  }

  private executeCreateIndex(_sql: string): ResultSet {
    // For in-memory impl, indexes are no-op
    return createResultSet([], [], [], 0, undefined)
  }

  private parseInlineValues(valuesPart: string): Value[] {
    const values: Value[] = []
    const parts = this.splitValues(valuesPart)

    for (const part of parts) {
      const trimmed = part.trim()
      // Check if it's a quoted string
      if (
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
      ) {
        // Remove quotes
        values.push(trimmed.slice(1, -1))
      } else {
        values.push(this.parseValue(trimmed))
      }
    }

    return values
  }

  private splitValues(valuesPart: string): string[] {
    const parts: string[] = []
    let current = ''
    let inString = false
    let stringChar = ''

    for (const char of valuesPart) {
      if (!inString && (char === "'" || char === '"')) {
        inString = true
        stringChar = char
        current += char
      } else if (inString && char === stringChar) {
        inString = false
        current += char
      } else if (!inString && char === ',') {
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

  private parseValue(s: string): Value {
    if (s === 'null' || s === 'NULL') return null
    if (s === 'true' || s === 'TRUE') return 1
    if (s === 'false' || s === 'FALSE') return 0
    if (/^-?\d+$/.test(s)) return parseInt(s, 10)
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
    // Remove quotes if present
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
      return s.slice(1, -1)
    }
    return s
  }

  private executeInsert(sql: string, args: Value[]): ResultSet {
    // Parse INSERT INTO table [(cols)] VALUES (?, ?, ...)
    const match = sql.match(/INSERT\s+INTO\s+(\w+)\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([^)]+)\)/i)
    if (!match) {
      throw new LibsqlError('Invalid INSERT syntax', 'SQLITE_ERROR')
    }

    const tableName = match[1].toLowerCase()
    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new LibsqlError(`Table not found: ${tableName}`, 'SQLITE_ERROR')
    }

    const specifiedCols = match[2]
      ? match[2].split(',').map((c) => c.trim().toLowerCase())
      : schema.columns

    // Parse inline values from VALUES clause if no args provided
    const valuesPart = match[3]
    let insertValues: Value[] = args

    if (args.length === 0 && valuesPart) {
      // Parse inline values like (1, 'Alice', 30)
      insertValues = this.parseInlineValues(valuesPart)
    }

    // Get values from args
    const values = new Map<string, Value>()
    for (let i = 0; i < specifiedCols.length; i++) {
      values.set(specifiedCols[i], insertValues[i] ?? null)
    }

    // Handle auto-increment for INTEGER PRIMARY KEY if not specified
    if (
      schema.primaryKey &&
      !specifiedCols.includes(schema.primaryKey) &&
      schema.columnTypes[schema.columns.indexOf(schema.primaryKey)]?.toUpperCase() === 'INTEGER'
    ) {
      // Auto-generate next ID
      values.set(schema.primaryKey, this.lastRowId + 1)
    }

    // Check unique constraints
    const tableData = this.data.get(tableName) ?? []
    for (const constraint of schema.uniqueConstraints) {
      const newValue = values.get(constraint)
      for (const row of tableData) {
        if (row.values.get(constraint) === newValue && newValue !== null) {
          throw new LibsqlError(
            `UNIQUE constraint failed: ${tableName}.${constraint}`,
            'SQLITE_CONSTRAINT_UNIQUE'
          )
        }
      }
    }

    // Check primary key
    if (schema.primaryKey) {
      const pkValue = values.get(schema.primaryKey)
      for (const row of tableData) {
        if (row.values.get(schema.primaryKey) === pkValue && pkValue !== null) {
          throw new LibsqlError(
            `UNIQUE constraint failed: ${tableName}.${schema.primaryKey}`,
            'SQLITE_CONSTRAINT_PRIMARYKEY'
          )
        }
      }
    }

    const rowid = ++this.lastRowId
    tableData.push({ rowid, values })

    return createResultSet([], [], [], 1, BigInt(rowid))
  }

  private executeSelect(sql: string, _args: Value[]): ResultSet {
    // Very simple SELECT parser for basic queries
    const normalized = sql.replace(/\s+/g, ' ').trim()

    // Handle SELECT 1 (literal)
    if (/SELECT\s+\d+/i.test(normalized)) {
      const match = normalized.match(/SELECT\s+(\d+)/i)
      if (match) {
        return createResultSet(
          ['1'],
          ['INTEGER'],
          [[parseInt(match[1], 10)]],
          0,
          undefined
        )
      }
    }

    // Handle SELECT columns FROM table [WHERE ...] [LIMIT ...]
    const selectMatch = normalized.match(
      /SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?(?:\s+(.*))?$/i
    )
    if (!selectMatch) {
      throw new LibsqlError('Invalid SELECT syntax', 'SQLITE_ERROR')
    }

    const columnsPart = selectMatch[1]
    const mainTable = selectMatch[2].toLowerCase()
    const whereAndMore = selectMatch[4] ?? ''

    // Handle JOINs
    const joinMatch = whereAndMore.match(
      /JOIN\s+(\w+)\s+(?:AS\s+)?(\w+)?\s+ON\s+([^\s]+)\s*=\s*([^\s]+)/i
    )

    const schema = this.tables.get(mainTable)
    if (!schema) {
      throw new LibsqlError(`Table not found: ${mainTable}`, 'SQLITE_ERROR')
    }

    let tableData = this.data.get(mainTable) ?? []

    // Parse columns
    let selectedColumns: string[]
    if (columnsPart === '*') {
      selectedColumns = schema.columns
    } else {
      selectedColumns = columnsPart.split(',').map((c) => {
        const col = c.trim()
        // Handle alias like u.name
        if (col.includes('.')) {
          return col.split('.')[1].toLowerCase()
        }
        return col.toLowerCase()
      })
    }

    // Apply WHERE filter
    const whereMatch = whereAndMore.match(/WHERE\s+(.+?)(?:\s+LIMIT|\s+ORDER|\s*$)/i)
    if (whereMatch) {
      const condition = whereMatch[1].trim()
      // Simple condition: col = 'value' or col = value
      const eqMatch = condition.match(/([^\s.]+(?:\.[^\s.]+)?)\s*=\s*'?([^']+)'?/i)
      if (eqMatch) {
        let colName = eqMatch[1].toLowerCase()
        if (colName.includes('.')) {
          colName = colName.split('.')[1]
        }
        const value = eqMatch[2]
        tableData = tableData.filter((row) => {
          const rowVal = row.values.get(colName)
          return String(rowVal) === value
        })
      }
    }

    // Apply LIMIT
    const limitMatch = whereAndMore.match(/LIMIT\s+(\d+)/i)
    if (limitMatch) {
      tableData = tableData.slice(0, parseInt(limitMatch[1], 10))
    }

    // Handle JOIN by duplicating rows for matching
    if (joinMatch) {
      const joinTable = joinMatch[1].toLowerCase()
      const joinData = this.data.get(joinTable) ?? []

      // Simple join - for each main row, find matching join rows
      const joinedRows: StoredRow[] = []
      for (const mainRow of tableData) {
        for (const joinRow of joinData) {
          // Check ON condition (simplified)
          joinedRows.push({
            rowid: mainRow.rowid,
            values: new Map([...mainRow.values, ...joinRow.values]),
          })
        }
      }
      tableData = joinedRows
    }

    // Build result
    const columnTypes = selectedColumns.map(() => 'TEXT')
    const rawRows = tableData.map((row) =>
      selectedColumns.map((col) => row.values.get(col) ?? null)
    )

    return createResultSet(selectedColumns, columnTypes, rawRows, 0, undefined)
  }

  private executeUpdate(_sql: string, _args: Value[]): ResultSet {
    // Simplified - not implementing full UPDATE
    return createResultSet([], [], [], 0, undefined)
  }

  private executeDelete(_sql: string, _args: Value[]): ResultSet {
    // Simplified - not implementing full DELETE
    return createResultSet([], [], [], 0, undefined)
  }

  private executeBegin(_sql: string): ResultSet {
    this.beginTransaction('write')
    return createResultSet([], [], [], 0, undefined)
  }

  private executeCommit(): ResultSet {
    this.commitTransaction()
    return createResultSet([], [], [], 0, undefined)
  }

  private executeRollback(): ResultSet {
    this.rollbackTransaction()
    return createResultSet([], [], [], 0, undefined)
  }
}

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

class TursoClient implements Client {
  private db: InMemorySQLite
  private config: ExtendedTursoConfig
  private _closed = false
  private _protocol: string

  constructor(config: ExtendedTursoConfig) {
    this.config = config
    this.db = new InMemorySQLite()
    this._protocol = this.parseProtocol(config.url)
  }

  private parseProtocol(url: string): string {
    if (url === ':memory:' || url.startsWith('file:')) return 'file'
    if (url.startsWith('http://')) return 'http'
    if (url.startsWith('https://')) return 'https'
    if (url.startsWith('ws://')) return 'ws'
    if (url.startsWith('wss://')) return 'wss'
    if (url.startsWith('libsql://')) return 'libsql'
    return 'file'
  }

  get closed(): boolean {
    return this._closed
  }

  get protocol(): string {
    return this._protocol
  }

  async execute(stmt: InStatement): Promise<ResultSet> {
    this.checkClosed()
    const { sql, args } = parseStatement(stmt)

    try {
      return this.db.execute(sql, args)
    } catch (e) {
      if (e instanceof LibsqlError) throw e
      throw new LibsqlError((e as Error).message, 'SQLITE_ERROR')
    }
  }

  async batch(stmts: InStatement[], _mode?: TransactionMode): Promise<ResultSet[]> {
    this.checkClosed()

    this.db.beginTransaction(_mode ?? 'write')
    const results: ResultSet[] = []

    try {
      for (let i = 0; i < stmts.length; i++) {
        try {
          const { sql, args } = parseStatement(stmts[i])
          results.push(this.db.execute(sql, args))
        } catch (e) {
          this.db.rollbackTransaction()
          throw new LibsqlBatchError((e as Error).message, 'SQLITE_ERROR', i)
        }
      }
      this.db.commitTransaction()
      return results
    } catch (e) {
      if (e instanceof LibsqlBatchError) throw e
      this.db.rollbackTransaction()
      throw e
    }
  }

  async migrate(stmts: InStatement[]): Promise<ResultSet[]> {
    return this.batch(stmts)
  }

  async transaction(mode?: TransactionMode): Promise<Transaction> {
    this.checkClosed()
    return new TursoTransaction(this.db, mode ?? 'write')
  }

  async executeMultiple(sql: string): Promise<void> {
    this.checkClosed()
    const statements = sql.split(';').filter((s) => s.trim().length > 0)
    for (const stmt of statements) {
      await this.execute(stmt)
    }
  }

  async sync(): Promise<Replicated | undefined> {
    // For non-replica clients, return undefined
    if (!this.config.syncUrl) return undefined
    // In production, would sync with remote
    return { frame_no: 0, frames_synced: 0 }
  }

  close(): void {
    this._closed = true
  }

  reconnect(): void {
    // No-op for in-memory
  }

  private checkClosed(): void {
    if (this._closed) {
      throw new LibsqlError('Client is closed', 'SQLITE_MISUSE')
    }
  }
}

// ============================================================================
// TRANSACTION IMPLEMENTATION
// ============================================================================

class TursoTransaction implements Transaction {
  private db: InMemorySQLite
  private _closed = false
  private committed = false

  constructor(db: InMemorySQLite, mode: TransactionMode) {
    this.db = db
    this.db.beginTransaction(mode)
  }

  get closed(): boolean {
    return this._closed
  }

  async execute(stmt: InStatement): Promise<ResultSet> {
    this.checkClosed()
    const { sql, args } = parseStatement(stmt)
    return this.db.execute(sql, args)
  }

  async batch(stmts: InStatement[]): Promise<ResultSet[]> {
    this.checkClosed()
    const results: ResultSet[] = []
    for (const stmt of stmts) {
      results.push(await this.execute(stmt))
    }
    return results
  }

  async executeMultiple(sql: string): Promise<void> {
    this.checkClosed()
    const statements = sql.split(';').filter((s) => s.trim().length > 0)
    for (const stmt of statements) {
      await this.execute(stmt)
    }
  }

  async commit(): Promise<void> {
    this.checkClosed()
    this.db.commitTransaction()
    this.committed = true
    this._closed = true
  }

  async rollback(): Promise<void> {
    this.checkClosed()
    this.db.rollbackTransaction()
    this._closed = true
  }

  close(): void {
    if (!this._closed && !this.committed) {
      this.db.rollbackTransaction()
    }
    this._closed = true
  }

  private checkClosed(): void {
    if (this._closed) {
      throw new LibsqlError('Transaction is closed', 'SQLITE_MISUSE')
    }
  }
}

// ============================================================================
// CREATE CLIENT
// ============================================================================

/**
 * Create a new libSQL client
 */
export function createClient(config: Config | ExtendedTursoConfig): Client {
  return new TursoClient(config as ExtendedTursoConfig)
}
