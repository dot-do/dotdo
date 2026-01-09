/**
 * @dotdo/duckdb - DuckDB SDK compat
 *
 * Drop-in replacement for duckdb-node backed by DO SQLite.
 * This in-memory implementation matches the DuckDB Node.js API.
 * Production version routes to Durable Objects based on config.
 *
 * REFACTORED: Now uses the shared SQL engine infrastructure at
 * db/compat/sql/shared/ instead of duplicating SQL parsing/execution.
 * This reduces ~1300 lines of duplicated code.
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

// Import the shared SQL engine infrastructure
import {
  createSQLEngine,
  POSTGRES_DIALECT,
  type SQLEngine,
  type SQLValue,
  type ExecutionResult,
  SQLError as BaseSQLError,
  TableNotFoundError,
  TableExistsError,
  UniqueConstraintError,
  SQLParseError,
} from '../shared'

// ============================================================================
// DUCKDB SQL NORMALIZATION
// ============================================================================

/**
 * Normalize DuckDB-specific SQL to standard PostgreSQL syntax
 */
function normalizeDuckDbSql(sql: string): string {
  let result = sql

  // DuckDB uses $1, $2 style parameters like PostgreSQL (no change needed)

  // Handle DuckDB-specific types
  // HUGEINT -> INTEGER (simplified for in-memory)
  result = result.replace(/\bHUGEINT\b/gi, 'INTEGER')

  // UBIGINT -> INTEGER
  result = result.replace(/\bUBIGINT\b/gi, 'INTEGER')

  // LIST -> TEXT (simplified)
  result = result.replace(/\bLIST\s*<[^>]+>/gi, 'TEXT')

  // MAP -> TEXT (simplified)
  result = result.replace(/\bMAP\s*<[^>]+>/gi, 'TEXT')

  // STRUCT -> TEXT (simplified)
  result = result.replace(/\bSTRUCT\s*<[^>]+>/gi, 'TEXT')

  return result
}

// ============================================================================
// ERROR MAPPING
// ============================================================================

/**
 * Map shared SQL errors to DuckDB DuckDBError format
 */
function mapToDuckDBError(error: unknown): DuckDBError {
  if (error instanceof BaseSQLError) {
    let code = 'INTERNAL_ERROR'

    if (error instanceof TableNotFoundError) {
      code = 'CATALOG_ERROR'
    } else if (error instanceof TableExistsError) {
      code = 'CATALOG_ERROR'
    } else if (error instanceof UniqueConstraintError) {
      code = 'CONSTRAINT_ERROR'
    } else if (error instanceof SQLParseError) {
      code = 'PARSER_ERROR'
    }

    return new DuckDBError(error.message, code)
  }

  if (error instanceof Error) {
    return new DuckDBError(error.message, 'INTERNAL_ERROR')
  }

  return new DuckDBError(String(error), 'INTERNAL_ERROR')
}

// ============================================================================
// RESULT TRANSFORMATION
// ============================================================================

/**
 * Transform shared engine result to DuckDB row objects
 */
function transformToRowObjects<R>(result: ExecutionResult): R[] {
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < result.columns.length; i++) {
      obj[result.columns[i]] = row[i]
    }
    return obj as R
  })
}

/**
 * Transform shared engine result to DuckDB QueryResult format
 */
function transformToQueryResult(result: ExecutionResult): QueryResult {
  return {
    columns: result.columns,
    rows: result.rows as unknown[][],
    rowCount: result.affectedRows || result.rows.length,
    changedRows: result.changedRows,
    lastInsertRowid: result.lastInsertRowid,
  }
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

class DuckDBDatabase implements IDatabase {
  private engine: SQLEngine
  private config: ExtendedDuckDBConfig
  private _isClosed = false

  constructor(path: string, configOrCallback?: DatabaseConfig | DatabaseCallback, callback?: DatabaseCallback) {
    // Parse arguments
    let config: DatabaseConfig = {}
    let cb: DatabaseCallback | undefined

    if (typeof configOrCallback === 'function') {
      cb = configOrCallback
    } else if (configOrCallback) {
      config = configOrCallback
      cb = callback
    }

    this.config = { path, ...config } as ExtendedDuckDBConfig
    this.engine = createSQLEngine(POSTGRES_DIALECT)

    // Async initialization callback
    if (cb) {
      setTimeout(() => cb!(null), 0)
    }
  }

  connect(path?: string): IConnection {
    if (this._isClosed) {
      throw new DuckDBError('Database is closed', 'INTERNAL_ERROR')
    }
    return new DuckDBConnection(this, this.engine)
  }

  interrupt(): void {
    // No-op for in-memory
  }

  close(callback?: CloseCallback): void
  close(force: boolean, callback?: CloseCallback): void
  close(forceOrCallback?: boolean | CloseCallback, callback?: CloseCallback): void {
    let cb: CloseCallback | undefined

    if (typeof forceOrCallback === 'function') {
      cb = forceOrCallback
    } else {
      cb = callback
    }

    this._isClosed = true

    if (cb) {
      setTimeout(() => cb!(null), 0)
    }
  }

  run(sql: string, ...paramsOrCallback: (unknown | RunCallback)[]): this {
    const { params, callback } = this.extractParamsAndCallback<RunCallback>(paramsOrCallback)

    try {
      const normalizedSql = normalizeDuckDbSql(sql)
      this.engine.execute(normalizedSql, params as SQLValue[])
      if (callback) {
        setTimeout(() => callback(null), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e)), 0)
      }
    }

    return this
  }

  all<R = Record<string, unknown>>(sql: string, ...paramsOrCallback: (unknown | AllCallback<R>)[]): this {
    const { params, callback } = this.extractParamsAndCallback<AllCallback<R>>(paramsOrCallback)

    try {
      const normalizedSql = normalizeDuckDbSql(sql)
      const result = this.engine.execute(normalizedSql, params as SQLValue[])
      const rows = transformToRowObjects<R>(result)
      if (callback) {
        setTimeout(() => callback(null, rows), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e), []), 0)
      }
    }

    return this
  }

  get<R = Record<string, unknown>>(sql: string, ...paramsOrCallback: (unknown | GetCallback<R>)[]): this {
    const { params, callback } = this.extractParamsAndCallback<GetCallback<R>>(paramsOrCallback)

    try {
      const normalizedSql = normalizeDuckDbSql(sql)
      const result = this.engine.execute(normalizedSql, params as SQLValue[])
      const rows = transformToRowObjects<R>(result)
      if (callback) {
        setTimeout(() => callback(null, rows[0] ?? null), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e), null), 0)
      }
    }

    return this
  }

  each<R = Record<string, unknown>>(
    sql: string,
    ...paramsOrCallback: (unknown | EachRowCallback<R> | EachCompleteCallback)[]
  ): this {
    const args = [...paramsOrCallback]
    const completeCallback = typeof args[args.length - 1] === 'function' ? args.pop() as EachCompleteCallback : undefined
    const rowCallback = typeof args[args.length - 1] === 'function' ? args.pop() as EachRowCallback<R> : undefined
    const params = args as unknown[]

    try {
      const normalizedSql = normalizeDuckDbSql(sql)
      const result = this.engine.execute(normalizedSql, params as SQLValue[])
      const rows = transformToRowObjects<R>(result)

      let index = 0
      for (const row of rows) {
        if (rowCallback) {
          rowCallback(null, row)
        }
        index++
      }

      if (completeCallback) {
        setTimeout(() => completeCallback(null, index), 0)
      }
    } catch (e) {
      if (completeCallback) {
        setTimeout(() => completeCallback(mapToDuckDBError(e), 0), 0)
      }
    }

    return this
  }

  prepare(sql: string, ...paramsOrCallback: (unknown | ((err: DuckDBError | null, stmt: IStatement) => void))[]): this {
    const { params, callback } = this.extractParamsAndCallback<(err: DuckDBError | null, stmt: IStatement) => void>(paramsOrCallback)

    try {
      const stmt = new DuckDBStatement(this.engine, sql, params)
      if (callback) {
        setTimeout(() => callback(null, stmt), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e), null as unknown as IStatement), 0)
      }
    }

    return this
  }

  exec(sql: string, callback?: (err: DuckDBError | null) => void): this {
    try {
      const statements = sql.split(';').filter((s) => s.trim().length > 0)
      for (const stmt of statements) {
        const normalizedSql = normalizeDuckDbSql(stmt)
        this.engine.execute(normalizedSql, [])
      }
      if (callback) {
        setTimeout(() => callback(null), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e)), 0)
      }
    }

    return this
  }

  serialize(_callback?: () => void): void {
    // No-op for in-memory, call callback synchronously
    _callback?.()
  }

  parallelize(_callback?: () => void): void {
    // No-op for in-memory, call callback synchronously
    _callback?.()
  }

  private extractParamsAndCallback<T extends (...args: unknown[]) => void>(
    args: (unknown | T)[]
  ): { params: unknown[]; callback?: T } {
    if (args.length === 0) {
      return { params: [] }
    }

    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      return {
        params: args.slice(0, -1) as unknown[],
        callback: lastArg as T,
      }
    }

    return { params: args as unknown[] }
  }
}

// ============================================================================
// CONNECTION IMPLEMENTATION
// ============================================================================

class DuckDBConnection implements IConnection {
  private db: DuckDBDatabase
  private engine: SQLEngine
  private _isClosed = false

  constructor(db: DuckDBDatabase, engine: SQLEngine) {
    this.db = db
    this.engine = engine
  }

  close(callback?: CloseCallback): void
  close(force: boolean, callback?: CloseCallback): void
  close(forceOrCallback?: boolean | CloseCallback, callback?: CloseCallback): void {
    let cb: CloseCallback | undefined

    if (typeof forceOrCallback === 'function') {
      cb = forceOrCallback
    } else {
      cb = callback
    }

    this._isClosed = true

    if (cb) {
      setTimeout(() => cb!(null), 0)
    }
  }

  run(sql: string, ...paramsOrCallback: (unknown | RunCallback)[]): this {
    const { params, callback } = this.extractParamsAndCallback<RunCallback>(paramsOrCallback)

    try {
      const normalizedSql = normalizeDuckDbSql(sql)
      this.engine.execute(normalizedSql, params as SQLValue[])
      if (callback) {
        setTimeout(() => callback(null), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e)), 0)
      }
    }

    return this
  }

  all<R = Record<string, unknown>>(sql: string, ...paramsOrCallback: (unknown | AllCallback<R>)[]): this {
    const { params, callback } = this.extractParamsAndCallback<AllCallback<R>>(paramsOrCallback)

    try {
      const normalizedSql = normalizeDuckDbSql(sql)
      const result = this.engine.execute(normalizedSql, params as SQLValue[])
      const rows = transformToRowObjects<R>(result)
      if (callback) {
        setTimeout(() => callback(null, rows), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e), []), 0)
      }
    }

    return this
  }

  get<R = Record<string, unknown>>(sql: string, ...paramsOrCallback: (unknown | GetCallback<R>)[]): this {
    const { params, callback } = this.extractParamsAndCallback<GetCallback<R>>(paramsOrCallback)

    try {
      const normalizedSql = normalizeDuckDbSql(sql)
      const result = this.engine.execute(normalizedSql, params as SQLValue[])
      const rows = transformToRowObjects<R>(result)
      if (callback) {
        setTimeout(() => callback(null, rows[0] ?? null), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e), null), 0)
      }
    }

    return this
  }

  prepare(sql: string, ...paramsOrCallback: (unknown | ((err: DuckDBError | null, stmt: IStatement) => void))[]): this {
    const { params, callback } = this.extractParamsAndCallback<(err: DuckDBError | null, stmt: IStatement) => void>(paramsOrCallback)

    try {
      const stmt = new DuckDBStatement(this.engine, sql, params)
      if (callback) {
        setTimeout(() => callback(null, stmt), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e), null as unknown as IStatement), 0)
      }
    }

    return this
  }

  private extractParamsAndCallback<T extends (...args: unknown[]) => void>(
    args: (unknown | T)[]
  ): { params: unknown[]; callback?: T } {
    if (args.length === 0) {
      return { params: [] }
    }

    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      return {
        params: args.slice(0, -1) as unknown[],
        callback: lastArg as T,
      }
    }

    return { params: args as unknown[] }
  }
}

// ============================================================================
// STATEMENT IMPLEMENTATION
// ============================================================================

class DuckDBStatement implements IStatement {
  private engine: SQLEngine
  private sql: string
  private boundParams: unknown[]

  constructor(engine: SQLEngine, sql: string, params: unknown[] = []) {
    this.engine = engine
    this.sql = sql
    this.boundParams = params
  }

  bind(...params: unknown[]): this {
    this.boundParams = params
    return this
  }

  run(...paramsOrCallback: (unknown | RunCallback)[]): this {
    const { params, callback } = this.extractParamsAndCallback<RunCallback>(paramsOrCallback)
    const execParams = params.length > 0 ? params : this.boundParams

    try {
      const normalizedSql = normalizeDuckDbSql(this.sql)
      this.engine.execute(normalizedSql, execParams as SQLValue[])
      if (callback) {
        setTimeout(() => callback(null), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e)), 0)
      }
    }

    return this
  }

  all<R = Record<string, unknown>>(...paramsOrCallback: (unknown | AllCallback<R>)[]): this {
    const { params, callback } = this.extractParamsAndCallback<AllCallback<R>>(paramsOrCallback)
    const execParams = params.length > 0 ? params : this.boundParams

    try {
      const normalizedSql = normalizeDuckDbSql(this.sql)
      const result = this.engine.execute(normalizedSql, execParams as SQLValue[])
      const rows = transformToRowObjects<R>(result)
      if (callback) {
        setTimeout(() => callback(null, rows), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e), []), 0)
      }
    }

    return this
  }

  get<R = Record<string, unknown>>(...paramsOrCallback: (unknown | GetCallback<R>)[]): this {
    const { params, callback } = this.extractParamsAndCallback<GetCallback<R>>(paramsOrCallback)
    const execParams = params.length > 0 ? params : this.boundParams

    try {
      const normalizedSql = normalizeDuckDbSql(this.sql)
      const result = this.engine.execute(normalizedSql, execParams as SQLValue[])
      const rows = transformToRowObjects<R>(result)
      if (callback) {
        setTimeout(() => callback(null, rows[0] ?? null), 0)
      }
    } catch (e) {
      if (callback) {
        setTimeout(() => callback(mapToDuckDBError(e), null), 0)
      }
    }

    return this
  }

  reset(): this {
    this.boundParams = []
    return this
  }

  finalize(callback?: FinalizeCallback): void {
    if (callback) {
      setTimeout(() => callback(null), 0)
    }
  }

  private extractParamsAndCallback<T extends (...args: unknown[]) => void>(
    args: (unknown | T)[]
  ): { params: unknown[]; callback?: T } {
    if (args.length === 0) {
      return { params: [] }
    }

    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      return {
        params: args.slice(0, -1) as unknown[],
        callback: lastArg as T,
      }
    }

    return { params: args as unknown[] }
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
 * Default export matching duckdb-node module structure
 */
export default {
  Database: DuckDBDatabase,
  Connection: DuckDBConnection,
  Statement: DuckDBStatement,
  DuckDBError,
}
