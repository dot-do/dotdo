/**
 * @dotdo/tidb - TiDB SDK compat
 *
 * Drop-in replacement for mysql2/promise backed by DO SQLite.
 * TiDB is MySQL wire-protocol compatible, so we reuse the MySQL
 * syntax translator with TiDB-specific enhancements.
 *
 * This in-memory implementation matches the mysql2 API.
 * Production version routes to Durable Objects based on config.
 *
 * REFACTORED: Now uses the shared SQL engine infrastructure at
 * db/compat/sql/shared/ instead of duplicating SQL parsing/execution.
 * This reduces ~1500 lines of duplicated code.
 *
 * @see https://docs.pingcap.com/tidb/stable
 * @see https://sidorares.github.io/node-mysql2/docs
 */
import type {
  Connection as IConnection,
  Pool as IPool,
  PoolConnection as IPoolConnection,
  ConnectionOptions,
  PoolOptions,
  ExtendedTiDBConfig,
  QueryOptions,
  QueryResult,
  RowDataPacket,
  ResultSetHeader,
  FieldPacket,
  PreparedStatementInfo,
} from './types'
import { TiDBError, ConnectionError, Types } from './types'
import { EventEmitter } from '../../../../compat/shared/event-emitter'

// Import the shared SQL engine infrastructure
import {
  createSQLEngine,
  MYSQL_DIALECT,
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
// ERROR MAPPING
// ============================================================================

/**
 * Map shared SQL errors to TiDB TiDBError format
 */
function mapToTiDBError(error: unknown): TiDBError {
  if (error instanceof BaseSQLError) {
    let mysqlCode = 'ER_UNKNOWN'
    let errno = 1000

    if (error instanceof TableNotFoundError) {
      mysqlCode = 'ER_NO_SUCH_TABLE'
      errno = 1146
    } else if (error instanceof TableExistsError) {
      mysqlCode = 'ER_TABLE_EXISTS_ERROR'
      errno = 1050
    } else if (error instanceof UniqueConstraintError) {
      mysqlCode = 'ER_DUP_ENTRY'
      errno = 1062
    } else if (error instanceof SQLParseError) {
      mysqlCode = 'ER_PARSE_ERROR'
      errno = 1064
    }

    return new TiDBError(error.message, mysqlCode, errno)
  }

  if (error instanceof Error) {
    return new TiDBError(error.message, 'ER_UNKNOWN', 1000)
  }

  return new TiDBError(String(error), 'ER_UNKNOWN', 1000)
}

// ============================================================================
// RESULT TRANSFORMATION
// ============================================================================

/**
 * Transform shared engine result to TiDB QueryResult format
 */
function transformToTiDBResult<T>(
  result: ExecutionResult,
  database: string
): QueryResult<T> {
  const fields: FieldPacket[] = result.columns.map((name) => ({
    name,
    table: '',
    db: database,
    orgName: name,
    orgTable: '',
    characterSet: 33, // utf8
    columnLength: 255,
    columnType: Types.VARCHAR,
    flags: 0,
    decimals: 0,
  }))

  if (result.command === 'SELECT') {
    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i]] = row[i]
      }
      return obj as T extends unknown[] ? T[number] : T
    })
    return [rows as T, fields]
  } else {
    // For INSERT, UPDATE, DELETE - return ResultSetHeader
    const header: ResultSetHeader = {
      affectedRows: result.affectedRows,
      changedRows: result.changedRows,
      fieldCount: 0,
      insertId: result.lastInsertRowid,
      serverStatus: 2,
      warningCount: 0,
      info: '',
    }
    return [header as T, fields]
  }
}

// ============================================================================
// CONNECTION IMPLEMENTATION
// ============================================================================

class TiDBConnection extends EventEmitter implements IConnection {
  protected engine: SQLEngine
  private config: ExtendedTiDBConfig
  private _threadId = Math.floor(Math.random() * 100000)
  private preparedStatements = new Map<string, PreparedStatementInfo>()
  private stmtIdCounter = 0

  constructor(config: ConnectionOptions | ExtendedTiDBConfig, sharedEngine?: SQLEngine) {
    super()
    this.config = config as ExtendedTiDBConfig
    this.engine = sharedEngine ?? createSQLEngine(MYSQL_DIALECT)
  }

  // Override on/off to match the Connection interface signatures
  override on(event: 'error', handler: (err: Error) => void): this
  override on(event: 'end', handler: () => void): this
  override on(event: string, handler: (...args: any[]) => void): this
  override on(event: string, handler: (...args: any[]) => void): this {
    return super.on(event, handler)
  }

  override off(event: string, handler: (...args: any[]) => void): this {
    return super.off(event, handler)
  }

  get threadId(): number | null {
    return this._threadId
  }

  async query<T = RowDataPacket[]>(
    sqlOrOptions: string | QueryOptions,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    const sql = typeof sqlOrOptions === 'string' ? sqlOrOptions : sqlOrOptions.sql
    const params = typeof sqlOrOptions === 'string' ? (values ?? []) : (sqlOrOptions.values ?? [])

    try {
      const result = this.engine.execute(sql, params as SQLValue[])
      return transformToTiDBResult<T>(result, this.config.database ?? '')
    } catch (e) {
      throw mapToTiDBError(e)
    }
  }

  async execute<T = RowDataPacket[]>(
    sqlOrOptions: string | QueryOptions,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    // execute is essentially the same as query for prepared statements
    return this.query<T>(sqlOrOptions, values)
  }

  async beginTransaction(): Promise<void> {
    await this.query('BEGIN')
  }

  async commit(): Promise<void> {
    await this.query('COMMIT')
  }

  async rollback(): Promise<void> {
    await this.query('ROLLBACK')
  }

  async ping(): Promise<void> {
    // No-op for in-memory
  }

  async changeUser(_options: { user?: string; password?: string; database?: string }): Promise<void> {
    // No-op for in-memory
  }

  async prepare(sql: string): Promise<PreparedStatementInfo> {
    const id = ++this.stmtIdCounter
    const info: PreparedStatementInfo = {
      id,
      parameters: [],
      columns: [],
      close: async () => {
        this.preparedStatements.delete(sql)
      },
      execute: async (values?: unknown[]) => {
        return this.execute(sql, values)
      },
    }
    this.preparedStatements.set(sql, info)
    return info
  }

  unprepare(sql: string): void {
    this.preparedStatements.delete(sql)
  }

  async end(): Promise<void> {
    this.emit('end')
  }

  destroy(): void {
    this.emit('end')
  }

  pause(): void {
    // No-op
  }

  resume(): void {
    // No-op
  }

  format(sql: string, values?: unknown[]): string {
    if (!values || values.length === 0) return sql

    let result = sql
    let index = 0
    result = result.replace(/\?/g, () => {
      const value = values[index++]
      return this.escape(value)
    })
    return result
  }

  escape(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL'
    }
    if (typeof value === 'number') {
      return String(value)
    }
    if (typeof value === 'boolean') {
      return value ? '1' : '0'
    }
    if (value instanceof Date) {
      return `'${value.toISOString()}'`
    }
    // String
    return "'" + String(value).replace(/'/g, "\\'") + "'"
  }

  escapeId(value: string): string {
    return '`' + value.replace(/`/g, '``') + '`'
  }
}

// ============================================================================
// POOL IMPLEMENTATION
// ============================================================================

class TiDBPool extends EventEmitter implements IPool {
  private config: ExtendedTiDBConfig
  private connections: Set<TiDBPoolConnection> = new Set()
  private idleConnections: TiDBPoolConnection[] = []
  private waitingRequests: Array<{
    resolve: (conn: IPoolConnection) => void
    reject: (err: Error) => void
  }> = []
  private _ended = false
  private sharedEngine: SQLEngine

  constructor(config: PoolOptions | ExtendedTiDBConfig) {
    super()
    this.config = {
      connectionLimit: 10,
      queueLimit: 0,
      waitForConnections: true,
      ...config,
    } as ExtendedTiDBConfig
    // All pool connections share the same engine for consistent state
    this.sharedEngine = createSQLEngine(MYSQL_DIALECT)
  }

  // Override on to match the Pool interface signatures
  override on(event: 'acquire', handler: (connection: IPoolConnection) => void): this
  override on(event: 'connection', handler: (connection: IPoolConnection) => void): this
  override on(event: 'enqueue', handler: () => void): this
  override on(event: 'release', handler: (connection: IPoolConnection) => void): this
  override on(event: 'error', handler: (err: Error) => void): this
  override on(event: string, handler: (...args: any[]) => void): this
  override on(event: string, handler: (...args: any[]) => void): this {
    return super.on(event, handler)
  }

  get pool() {
    return {
      _allConnections: { length: this.connections.size },
      _freeConnections: { length: this.idleConnections.length },
      _connectionQueue: { length: this.waitingRequests.length },
    }
  }

  async query<T = RowDataPacket[]>(
    sqlOrOptions: string | QueryOptions,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    const connection = await this.getConnection()
    try {
      const result = typeof sqlOrOptions === 'string'
        ? await connection.query<T>(sqlOrOptions, values as any[])
        : await connection.query<T>(sqlOrOptions)
      connection.release()
      return result
    } catch (e) {
      connection.release()
      throw e
    }
  }

  async execute<T = RowDataPacket[]>(
    sqlOrOptions: string | QueryOptions,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    const connection = await this.getConnection()
    try {
      const result = typeof sqlOrOptions === 'string'
        ? await connection.execute<T>(sqlOrOptions, values as any[])
        : await connection.execute<T>(sqlOrOptions)
      connection.release()
      return result
    } catch (e) {
      connection.release()
      throw e
    }
  }

  async getConnection(): Promise<IPoolConnection> {
    if (this._ended) {
      throw new ConnectionError('Pool is closed')
    }

    // Check for idle connection
    if (this.idleConnections.length > 0) {
      const connection = this.idleConnections.pop()!
      this.emit('acquire', connection)
      return connection
    }

    // Create new connection if under limit
    const limit = this.config.connectionLimit ?? 10
    if (this.connections.size < limit) {
      const connection = new TiDBPoolConnection(this.config, this, this.sharedEngine)
      this.connections.add(connection)
      this.emit('connection', connection)
      this.emit('acquire', connection)
      return connection
    }

    // Wait for available connection
    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.connectTimeout ?? 30000
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
        resolve: (conn) => {
          clearTimeout(timer)
          resolve(conn)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
      this.emit('enqueue')
    })
  }

  _releaseConnection(connection: TiDBPoolConnection): void {
    // Check for waiting requests
    if (this.waitingRequests.length > 0) {
      const waiter = this.waitingRequests.shift()!
      this.emit('acquire', connection)
      waiter.resolve(connection)
      return
    }

    // Return to idle pool
    this.idleConnections.push(connection)
    this.emit('release', connection)
  }

  async end(): Promise<void> {
    this._ended = true

    this.waitingRequests.forEach((waiter) => {
      waiter.reject(new ConnectionError('Pool is closed'))
    })
    this.waitingRequests = []

    const endPromises: Promise<void>[] = []
    this.connections.forEach((connection) => {
      endPromises.push(connection.end())
    })
    await Promise.all(endPromises)

    this.connections.clear()
    this.idleConnections = []
  }
}

class TiDBPoolConnection extends TiDBConnection implements IPoolConnection {
  private pool: TiDBPool

  constructor(config: ExtendedTiDBConfig, pool: TiDBPool, sharedEngine: SQLEngine) {
    super(config, sharedEngine)
    this.pool = pool
  }

  get connection(): IConnection {
    return this as unknown as IConnection
  }

  release(): void {
    this.pool._releaseConnection(this)
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export async function createConnection(
  config: ConnectionOptions | ExtendedTiDBConfig
): Promise<IConnection> {
  const connection = new TiDBConnection(config)
  return connection
}

export function createPool(config: PoolOptions | ExtendedTiDBConfig): IPool {
  return new TiDBPool(config)
}

// ============================================================================
// EXPORTS
// ============================================================================

export { Types }
export { TiDBError, ConnectionError }

/**
 * Default export matching mysql2/promise module structure
 */
export const tidb = {
  createConnection,
  createPool,
  Types,
  TiDBError,
  ConnectionError,
}

export default tidb
