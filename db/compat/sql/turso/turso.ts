/**
 * @dotdo/turso - Turso/libSQL SDK compat
 *
 * Drop-in replacement for @libsql/client backed by DO SQLite.
 * This in-memory implementation matches the libSQL Client API.
 * Production version routes to Durable Objects based on config.
 *
 * REFACTORED: Now uses the shared SQL engine infrastructure at
 * db/compat/sql/shared/ instead of duplicating SQL parsing/execution.
 * This reduces ~400 lines of duplicated code.
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

// Import the shared SQL engine infrastructure
import {
  createSQLEngine,
  SQLITE_DIALECT,
  type SQLEngine,
  type SQLValue,
  type ExecutionResult,
  type StorageValue,
  SQLError as BaseSQLError,
  TableNotFoundError,
  UniqueConstraintError,
  SQLParseError,
  ReadOnlyTransactionError,
} from '../shared'

// ============================================================================
// ERROR MAPPING
// ============================================================================

/**
 * Map shared SQL errors to libSQL LibsqlError format
 */
function mapToTursoError(error: unknown): LibsqlError {
  if (error instanceof BaseSQLError) {
    let code = 'SQLITE_ERROR'

    if (error instanceof TableNotFoundError) {
      code = 'SQLITE_ERROR'
    } else if (error instanceof UniqueConstraintError) {
      code = 'SQLITE_CONSTRAINT_UNIQUE'
    } else if (error instanceof SQLParseError) {
      code = 'SQLITE_ERROR'
    } else if (error instanceof ReadOnlyTransactionError) {
      code = 'SQLITE_READONLY'
    }

    return new LibsqlError(error.message, code)
  }

  if (error instanceof Error) {
    return new LibsqlError(error.message, 'SQLITE_ERROR')
  }

  return new LibsqlError(String(error), 'SQLITE_ERROR')
}

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
function createRow(values: StorageValue[], columns: string[]): Row {
  const row: Row = {
    length: values.length,
  }

  // Set values by index
  for (let i = 0; i < values.length; i++) {
    row[i] = values[i] as Value
  }

  // Set values by column name
  for (let i = 0; i < columns.length; i++) {
    row[columns[i]] = values[i] as Value
  }

  return row
}

/**
 * Create a ResultSet from raw data (exported for testing)
 */
export function createResultSet(
  columns: string[],
  columnTypes: string[],
  rawRows: Value[][],
  rowsAffected: number,
  lastInsertRowid: bigint | undefined
): ResultSet {
  const rows = rawRows.map((values) => createRow(values as StorageValue[], columns))

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

/**
 * Transform shared engine result to libSQL ResultSet format
 */
function transformToResultSet(result: ExecutionResult): ResultSet {
  const rows = result.rows.map((values) => createRow(values, result.columns))

  return {
    columns: result.columns,
    columnTypes: result.columnTypes,
    rows,
    rowsAffected: result.affectedRows,
    lastInsertRowid: result.lastInsertRowid > 0 ? BigInt(result.lastInsertRowid) : undefined,
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
// CLIENT IMPLEMENTATION
// ============================================================================

class TursoClient implements Client {
  private engine: SQLEngine
  private config: ExtendedTursoConfig
  private _closed = false
  private _protocol: string

  constructor(config: ExtendedTursoConfig) {
    this.config = config
    this.engine = createSQLEngine(SQLITE_DIALECT)
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
      const result = this.engine.execute(sql, args as SQLValue[])
      return transformToResultSet(result)
    } catch (e) {
      if (e instanceof LibsqlError) throw e
      throw mapToTursoError(e)
    }
  }

  async batch(stmts: InStatement[], _mode?: TransactionMode): Promise<ResultSet[]> {
    this.checkClosed()

    this.engine.beginTransaction(_mode ?? 'write')
    const results: ResultSet[] = []

    try {
      for (let i = 0; i < stmts.length; i++) {
        try {
          const { sql, args } = parseStatement(stmts[i])
          const result = this.engine.execute(sql, args as SQLValue[])
          results.push(transformToResultSet(result))
        } catch (e) {
          this.engine.rollbackTransaction()
          throw new LibsqlBatchError((e as Error).message, 'SQLITE_ERROR', i)
        }
      }
      this.engine.commitTransaction()
      return results
    } catch (e) {
      if (e instanceof LibsqlBatchError) throw e
      this.engine.rollbackTransaction()
      throw e
    }
  }

  async migrate(stmts: InStatement[]): Promise<ResultSet[]> {
    return this.batch(stmts)
  }

  async transaction(mode?: TransactionMode): Promise<Transaction> {
    this.checkClosed()
    return new TursoTransaction(this.engine, mode ?? 'write')
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
  private engine: SQLEngine
  private _closed = false
  private committed = false

  constructor(engine: SQLEngine, mode: TransactionMode) {
    this.engine = engine
    this.engine.beginTransaction(mode)
  }

  get closed(): boolean {
    return this._closed
  }

  async execute(stmt: InStatement): Promise<ResultSet> {
    this.checkClosed()
    const { sql, args } = parseStatement(stmt)

    try {
      const result = this.engine.execute(sql, args as SQLValue[])
      return transformToResultSet(result)
    } catch (e) {
      throw mapToTursoError(e)
    }
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
    this.engine.commitTransaction()
    this.committed = true
    this._closed = true
  }

  async rollback(): Promise<void> {
    this.checkClosed()
    this.engine.rollbackTransaction()
    this._closed = true
  }

  close(): void {
    if (!this._closed && !this.committed) {
      this.engine.rollbackTransaction()
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
