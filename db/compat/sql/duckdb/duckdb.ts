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

  // Convert ? placeholders to $N style for PostgreSQL dialect
  // Track position while avoiding replacing ? inside strings
  let paramIndex = 0
  let inString = false
  let stringChar = ''
  let newSql = ''

  for (let i = 0; i < result.length; i++) {
    const char = result[i]

    if (!inString && (char === "'" || char === '"')) {
      inString = true
      stringChar = char
      newSql += char
    } else if (inString && char === stringChar) {
      // Check for escaped quote
      if (result[i + 1] === stringChar) {
        newSql += char + result[i + 1]
        i++
      } else {
        inString = false
        newSql += char
      }
    } else if (!inString && char === '?') {
      paramIndex++
      newSql += `$${paramIndex}`
    } else {
      newSql += char
    }
  }
  result = newSql

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
      obj[result.columns[i]!] = row[i]
    }
    return obj as R
  })
}

/**
 * Transform shared engine result to DuckDB QueryResult format
 */
function transformToQueryResult(result: ExecutionResult): QueryResult {
  return {
    changes: result.affectedRows || result.rows.length,
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
  private _path: string

  constructor(path?: string, configOrCallback?: DatabaseConfig | DatabaseCallback, callback?: DatabaseCallback) {
    // Parse arguments
    let config: DatabaseConfig = {}
    let cb: DatabaseCallback | undefined

    if (typeof configOrCallback === 'function') {
      cb = configOrCallback
    } else if (configOrCallback) {
      config = configOrCallback
      cb = callback
    }

    this._path = path ?? ':memory:'
    this.config = { path: this._path, ...config } as ExtendedDuckDBConfig
    this.engine = createSQLEngine(POSTGRES_DIALECT)

    // Async initialization callback
    if (cb) {
      setTimeout(() => cb!(null), 0)
    }
  }

  get path(): string {
    return this._path
  }

  get open(): boolean {
    return !this._isClosed
  }

  connect(path?: string): Promise<IConnection> {
    if (this._isClosed) {
      throw new DuckDBError('Database is closed', 'INTERNAL_ERROR')
    }
    return Promise.resolve(new DuckDBConnection(this, this.engine))
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

  run(sql: string, ...paramsOrCallback: (unknown | RunCallback)[]): QueryResult {
    if (this._isClosed) {
      throw new DuckDBError('Database is closed', 'INTERNAL_ERROR')
    }

    const { params, callback } = this.extractParamsAndCallback<RunCallback>(paramsOrCallback)

    try {
      const normalizedSql = normalizeDuckDbSql(sql)
      const result = this.engine.execute(normalizedSql, params as SQLValue[])
      // For INSERT/DELETE use affectedRows, for UPDATE use changedRows (rows that actually changed values)
      // DuckDB returns number of rows matched for UPDATE, not rows changed
      const changes = result.command === 'UPDATE'
        ? result.affectedRows  // UPDATE returns matched rows
        : result.affectedRows  // INSERT/DELETE return affected rows
      const queryResult: QueryResult = {
        changes,
        lastInsertRowid: result.lastInsertRowid,
      }
      if (callback) {
        setTimeout(() => callback(null, queryResult), 0)
      }
      return queryResult
    } catch (e) {
      const err = mapToDuckDBError(e)
      if (callback) {
        setTimeout(() => callback(err), 0)
        return { changes: 0 }
      }
      throw err
    }
  }

  all<R = Record<string, unknown>>(sql: string, ...paramsOrCallback: (unknown | AllCallback<R>)[]): R[] {
    if (this._isClosed) {
      throw new DuckDBError('Database is closed', 'INTERNAL_ERROR')
    }

    const { params, callback } = this.extractParamsAndCallback<AllCallback<R>>(paramsOrCallback)

    try {
      const normalizedSql = normalizeDuckDbSql(sql)
      const result = this.engine.execute(normalizedSql, params as SQLValue[])
      const rows = transformToRowObjects<R>(result)
      if (callback) {
        setTimeout(() => callback(null, rows), 0)
      }
      return rows
    } catch (e) {
      const err = mapToDuckDBError(e)
      if (callback) {
        setTimeout(() => callback(err, []), 0)
        return []
      }
      throw err
    }
  }

  get<R = Record<string, unknown>>(sql: string, ...paramsOrCallback: (unknown | GetCallback<R>)[]): R | undefined {
    if (this._isClosed) {
      throw new DuckDBError('Database is closed', 'INTERNAL_ERROR')
    }

    const { params, callback } = this.extractParamsAndCallback<GetCallback<R>>(paramsOrCallback)

    try {
      const normalizedSql = normalizeDuckDbSql(sql)
      const result = this.engine.execute(normalizedSql, params as SQLValue[])
      const rows = transformToRowObjects<R>(result)
      const row = rows[0]
      if (callback) {
        setTimeout(() => callback(null, row as R | undefined), 0)
      }
      return row
    } catch (e) {
      const err = mapToDuckDBError(e)
      if (callback) {
        setTimeout(() => callback(err, undefined), 0)
        return undefined
      }
      throw err
    }
  }

  each<R = Record<string, unknown>>(
    sql: string,
    ...paramsOrCallback: (unknown | EachRowCallback<R> | EachCompleteCallback)[]
  ): void {
    if (this._isClosed) {
      throw new DuckDBError('Database is closed', 'INTERNAL_ERROR')
    }

    const args = [...paramsOrCallback]

    // Find callbacks from the end
    let completeCallback: EachCompleteCallback | undefined
    let rowCallback: EachRowCallback<R> | undefined

    // If last arg is a function, check if second-to-last is also a function
    if (typeof args[args.length - 1] === 'function') {
      if (args.length >= 2 && typeof args[args.length - 2] === 'function') {
        // Two callbacks: row callback, then complete callback
        completeCallback = args.pop() as EachCompleteCallback
        rowCallback = args.pop() as EachRowCallback<R>
      } else {
        // One callback: it's the row callback
        rowCallback = args.pop() as EachRowCallback<R>
      }
    }

    // Remaining args are params - handle array param pattern
    let params: unknown[] = args
    if (params.length === 1 && Array.isArray(params[0])) {
      params = params[0] as unknown[]
    }

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
        completeCallback(null, index)
      }
    } catch (e) {
      if (rowCallback) {
        rowCallback(mapToDuckDBError(e), null as unknown as R)
      }
      if (completeCallback) {
        completeCallback(mapToDuckDBError(e), 0)
      }
    }
  }

  prepare(sql: string, ...paramsOrCallback: (unknown | ((err: DuckDBError | null, stmt: IStatement) => void))[]): IStatement {
    if (this._isClosed) {
      throw new DuckDBError('Database is closed', 'INTERNAL_ERROR')
    }

    const { params, callback } = this.extractParamsAndCallback<(err: DuckDBError | null, stmt: IStatement) => void>(paramsOrCallback)

    const stmt = new DuckDBStatement(this.engine, sql, params)
    if (callback) {
      setTimeout(() => callback(null, stmt), 0)
    }
    return stmt
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

  private extractParamsAndCallback<T extends (...args: any[]) => void>(
    args: (unknown | T)[]
  ): { params: unknown[]; callback?: T } {
    if (args.length === 0) {
      return { params: [] }
    }

    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      const rawParams = args.slice(0, -1)
      // If first arg is an array, use it directly (common pattern: db.run(sql, [params]))
      const params = rawParams.length === 1 && Array.isArray(rawParams[0])
        ? (rawParams[0] as unknown[])
        : (rawParams as unknown[])
      return { params, callback: lastArg as T }
    }

    // If first arg is an array, use it directly
    if (args.length === 1 && Array.isArray(args[0])) {
      return { params: args[0] as unknown[] }
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

  async close(): Promise<void> {
    this._isClosed = true
  }

  async run(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const normalizedSql = normalizeDuckDbSql(sql)
    const result = this.engine.execute(normalizedSql, params as SQLValue[])
    return {
      changes: result.affectedRows,
      lastInsertRowid: result.lastInsertRowid,
    }
  }

  async all<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
    const normalizedSql = normalizeDuckDbSql(sql)
    const result = this.engine.execute(normalizedSql, params as SQLValue[])
    return transformToRowObjects<R>(result)
  }

  async get<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R | undefined> {
    const normalizedSql = normalizeDuckDbSql(sql)
    const result = this.engine.execute(normalizedSql, params as SQLValue[])
    const rows = transformToRowObjects<R>(result)
    return rows[0]
  }

  async prepare(sql: string): Promise<IStatement> {
    return new DuckDBStatement(this.engine, sql, [])
  }
}

// ============================================================================
// STATEMENT IMPLEMENTATION
// ============================================================================

class DuckDBStatement implements IStatement {
  private engine: SQLEngine
  private _sql: string
  private boundParams: unknown[]

  constructor(engine: SQLEngine, sql: string, params: unknown[] = []) {
    this.engine = engine
    this._sql = sql
    this.boundParams = params
  }

  get sql(): string {
    return this._sql
  }

  bind(...params: unknown[]): this {
    this.boundParams = params
    return this
  }

  run(...params: unknown[]): QueryResult {
    const execParams = params.length > 0 ? params : this.boundParams
    const normalizedSql = normalizeDuckDbSql(this._sql)
    const result = this.engine.execute(normalizedSql, execParams as SQLValue[])
    return {
      changes: result.affectedRows,
      lastInsertRowid: result.lastInsertRowid,
    }
  }

  all<R = Record<string, unknown>>(...params: unknown[]): R[] {
    const execParams = params.length > 0 ? params : this.boundParams
    const normalizedSql = normalizeDuckDbSql(this._sql)
    const result = this.engine.execute(normalizedSql, execParams as SQLValue[])
    return transformToRowObjects<R>(result)
  }

  get<R = Record<string, unknown>>(...params: unknown[]): R | undefined {
    const execParams = params.length > 0 ? params : this.boundParams
    const normalizedSql = normalizeDuckDbSql(this._sql)
    const result = this.engine.execute(normalizedSql, execParams as SQLValue[])
    const rows = transformToRowObjects<R>(result)
    return rows[0]
  }

  reset(): this {
    this.boundParams = []
    return this
  }

  finalize(callback?: FinalizeCallback): void {
    if (callback) {
      callback(null)
    }
  }
}

// ============================================================================
// ASYNC FACTORY
// ============================================================================

/**
 * Async factory function for creating a Database instance
 */
export async function open(path?: string, config?: DatabaseConfig): Promise<DuckDBDatabase> {
  return new DuckDBDatabase(path, config)
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
  open,
}
