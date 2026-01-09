/**
 * @dotdo/db/compat/sql/shared/dialects - Turso/libSQL Dialect
 *
 * Turso/libSQL-specific adapter for the shared SQL engine.
 * Provides libSQL-compatible result transformations and error handling.
 */

import { InMemorySQLEngine, type SQLEngine } from '../engine'
import {
  SQLITE_DIALECT,
  type ExecutionResult,
  type SQLValue,
  type StorageValue,
  type TransactionMode,
  SQLError,
} from '../types'

// ============================================================================
// TURSO/LIBSQL RESULT TYPES
// ============================================================================

/**
 * libSQL value types
 */
export type TursoValue = string | number | bigint | ArrayBuffer | null

/**
 * libSQL row - accessible by index and column name
 */
export interface TursoRow {
  length: number
  [index: number]: TursoValue
  [column: string]: TursoValue | number  // number for length property
}

/**
 * libSQL result set
 */
export interface TursoResultSet {
  columns: string[]
  columnTypes: string[]
  rows: TursoRow[]
  rowsAffected: number
  lastInsertRowid: bigint | undefined
  toJSON(): {
    columns: string[]
    columnTypes: string[]
    rows: Record<string, TursoValue>[]
    rowsAffected: number
    lastInsertRowid: string | undefined
  }
}

/**
 * libSQL statement input
 */
export type TursoInStatement =
  | string
  | {
      sql: string
      args?: TursoInArgs
    }

/**
 * libSQL args (positional or named)
 */
export type TursoInArgs = TursoInValue[] | Record<string, TursoInValue>

/**
 * libSQL input value
 */
export type TursoInValue =
  | string
  | number
  | bigint
  | boolean
  | ArrayBuffer
  | Uint8Array
  | Date
  | null
  | undefined

// ============================================================================
// TURSO ERROR TYPES
// ============================================================================

/**
 * libSQL error
 */
export class TursoLibsqlError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'LibsqlError'
  }
}

/**
 * libSQL batch error
 */
export class TursoLibsqlBatchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly stepIndex: number
  ) {
    super(message)
    this.name = 'LibsqlBatchError'
  }
}

/**
 * Map internal SQL errors to libSQL error format
 */
export function mapToTursoError(error: unknown): TursoLibsqlError {
  if (error instanceof SQLError) {
    let code = 'SQLITE_ERROR'
    if (error.name === 'TableNotFoundError') code = 'SQLITE_ERROR'
    else if (error.name === 'UniqueConstraintError') code = 'SQLITE_CONSTRAINT_UNIQUE'
    else if (error.name === 'SQLParseError') code = 'SQLITE_ERROR'
    else if (error.name === 'ReadOnlyTransactionError') code = 'SQLITE_READONLY'

    return new TursoLibsqlError(error.message, code)
  }

  if (error instanceof Error) {
    return new TursoLibsqlError(error.message, 'SQLITE_ERROR')
  }

  return new TursoLibsqlError(String(error), 'SQLITE_ERROR')
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse statement into SQL and args
 */
export function parseStatement(stmt: TursoInStatement): { sql: string; args: TursoValue[] } {
  if (typeof stmt === 'string') {
    return { sql: stmt, args: [] }
  }

  const args = normalizeArgs(stmt.args ?? [])
  return { sql: stmt.sql, args }
}

/**
 * Normalize args to array format
 */
function normalizeArgs(args: TursoInArgs): TursoValue[] {
  if (Array.isArray(args)) {
    return args.map(normalizeValue)
  }

  // Named args - return as array in order of object keys
  return Object.values(args).map(normalizeValue)
}

/**
 * Normalize a single value
 */
function normalizeValue(value: TursoInValue): TursoValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return value.buffer as ArrayBuffer
  return value as TursoValue
}

/**
 * Create a TursoRow from values and columns
 */
function createRow(values: StorageValue[], columns: string[]): TursoRow {
  const row: TursoRow = {
    length: values.length,
  }

  // Set values by index
  for (let i = 0; i < values.length; i++) {
    row[i] = values[i] as TursoValue
  }

  // Set values by column name
  for (let i = 0; i < columns.length; i++) {
    row[columns[i]] = values[i] as TursoValue
  }

  return row
}

/**
 * Create a TursoResultSet from execution result
 */
function createResultSet(result: ExecutionResult): TursoResultSet {
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
          const obj: Record<string, TursoValue> = {}
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
// TURSO DIALECT ADAPTER
// ============================================================================

/**
 * Turso/libSQL dialect adapter
 *
 * Wraps the shared SQL engine and transforms results to libSQL format.
 */
export class TursoDialect {
  private engine: SQLEngine

  constructor(engine?: SQLEngine) {
    this.engine = engine ?? new InMemorySQLEngine(SQLITE_DIALECT)
  }

  /**
   * Execute a single statement
   */
  execute(stmt: TursoInStatement): TursoResultSet {
    try {
      const { sql, args } = parseStatement(stmt)
      const result = this.engine.execute(sql, args as SQLValue[])
      return createResultSet(result)
    } catch (error) {
      throw mapToTursoError(error)
    }
  }

  /**
   * Execute a batch of statements
   */
  batch(stmts: TursoInStatement[], mode?: TransactionMode): TursoResultSet[] {
    this.engine.beginTransaction(mode ?? 'write')
    const results: TursoResultSet[] = []

    try {
      for (let i = 0; i < stmts.length; i++) {
        try {
          results.push(this.execute(stmts[i]))
        } catch (error) {
          this.engine.rollbackTransaction()
          const tursoError = mapToTursoError(error)
          throw new TursoLibsqlBatchError(tursoError.message, tursoError.code, i)
        }
      }
      this.engine.commitTransaction()
      return results
    } catch (error) {
      if (error instanceof TursoLibsqlBatchError) throw error
      this.engine.rollbackTransaction()
      throw error
    }
  }

  /**
   * Execute multiple SQL statements separated by semicolons
   */
  executeMultiple(sql: string): void {
    const statements = sql.split(';').filter((s) => s.trim().length > 0)
    for (const stmt of statements) {
      this.execute(stmt)
    }
  }

  /**
   * Begin a transaction and return a transaction object
   */
  transaction(mode?: TransactionMode): TursoTransaction {
    return new TursoTransaction(this.engine, mode ?? 'write')
  }

  /**
   * Get the underlying engine
   */
  getEngine(): SQLEngine {
    return this.engine
  }
}

/**
 * Turso transaction object
 */
export class TursoTransaction {
  private _closed = false
  private committed = false

  constructor(
    private engine: SQLEngine,
    mode: TransactionMode
  ) {
    this.engine.beginTransaction(mode)
  }

  get closed(): boolean {
    return this._closed
  }

  execute(stmt: TursoInStatement): TursoResultSet {
    this.checkClosed()
    try {
      const { sql, args } = parseStatement(stmt)
      const result = this.engine.execute(sql, args as SQLValue[])
      return createResultSet(result)
    } catch (error) {
      throw mapToTursoError(error)
    }
  }

  batch(stmts: TursoInStatement[]): TursoResultSet[] {
    this.checkClosed()
    const results: TursoResultSet[] = []
    for (const stmt of stmts) {
      results.push(this.execute(stmt))
    }
    return results
  }

  executeMultiple(sql: string): void {
    this.checkClosed()
    const statements = sql.split(';').filter((s) => s.trim().length > 0)
    for (const stmt of statements) {
      this.execute(stmt)
    }
  }

  commit(): void {
    this.checkClosed()
    this.engine.commitTransaction()
    this.committed = true
    this._closed = true
  }

  rollback(): void {
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
      throw new TursoLibsqlError('Transaction is closed', 'SQLITE_MISUSE')
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a Turso/libSQL dialect adapter
 */
export function createTursoDialect(engine?: SQLEngine): TursoDialect {
  return new TursoDialect(engine)
}
