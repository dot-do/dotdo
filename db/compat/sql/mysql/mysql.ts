/**
 * @dotdo/mysql - MySQL SDK compat
 *
 * Drop-in replacement for mysql2/promise backed by DO SQLite.
 * This in-memory implementation matches the mysql2 API.
 * Production version routes to Durable Objects based on config.
 *
 * REFACTORED: Now uses the shared SQL engine infrastructure at
 * db/compat/sql/shared/ instead of duplicating SQL parsing/execution.
 * This reduces ~1200 lines of duplicated code.
 *
 * @see https://sidorares.github.io/node-mysql2/docs
 */
import type {
  Connection as IConnection,
  Pool as IPool,
  PoolConnection as IPoolConnection,
  ConnectionOptions,
  PoolOptions,
  ExtendedMySQLConfig,
  QueryOptions,
  QueryResult,
  RowDataPacket,
  ResultSetHeader,
  FieldPacket,
  PreparedStatementInfo,
} from './types'
import { MySQLError, ConnectionError, Types } from './types'
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
 * Map shared SQL errors to MySQL MySQLError format
 */
function mapToMySQLError(error: unknown): MySQLError {
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

    return new MySQLError(error.message, mysqlCode, errno)
  }

  if (error instanceof Error) {
    return new MySQLError(error.message, 'ER_UNKNOWN', 1000)
  }

  return new MySQLError(String(error), 'ER_UNKNOWN', 1000)
}

// ============================================================================
// RESULT TRANSFORMATION
// ============================================================================

/**
 * Transform shared engine result to MySQL QueryResult format
 */
function transformToMySQLResult<T>(
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
      return obj as T extends any[] ? T[number] : T
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

// @ts-expect-error - EventEmitter 'on' method signature differs from mysql2 Connection interface
class MySQLConnection extends EventEmitter implements IConnection {
  protected engine: SQLEngine
  private config: ExtendedMySQLConfig
  private _threadId = Math.floor(Math.random() * 100000)
  private preparedStatements = new Map<string, PreparedStatementInfo>()
  private stmtIdCounter = 0

  constructor(config: ConnectionOptions | ExtendedMySQLConfig, sharedEngine?: SQLEngine) {
    super()
    this.config = config as ExtendedMySQLConfig
    this.engine = sharedEngine ?? createSQLEngine(MYSQL_DIALECT)
  }

  get threadId(): number | null {
    return this._threadId
  }

  async query<T = RowDataPacket[]>(
    sqlOrOptions: string | QueryOptions,
    values?: any[]
  ): Promise<QueryResult<T>> {
    const sql = typeof sqlOrOptions === 'string' ? sqlOrOptions : sqlOrOptions.sql
    const params = typeof sqlOrOptions === 'string' ? (values ?? []) : (sqlOrOptions.values ?? [])

    try {
      const result = this.engine.execute(sql, params as SQLValue[])
      return transformToMySQLResult<T>(result, this.config.database ?? '')
    } catch (e) {
      throw mapToMySQLError(e)
    }
  }

  async execute<T = RowDataPacket[]>(
    sqlOrOptions: string | QueryOptions,
    values?: any[]
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
      execute: async (values?: any[]) => {
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

  format(sql: string, values?: any[]): string {
    if (!values || values.length === 0) return sql

    let result = sql
    let index = 0
    result = result.replace(/\?/g, () => {
      const value = values[index++]
      return this.escape(value)
    })
    return result
  }

  escape(value: any): string {
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

// @ts-expect-error - EventEmitter 'on' method signature differs from mysql2 Pool interface
class MySQLPool extends EventEmitter implements IPool {
  private config: ExtendedMySQLConfig
  private connections: Set<MySQLPoolConnection> = new Set()
  private idleConnections: MySQLPoolConnection[] = []
  private waitingRequests: Array<{
    resolve: (conn: IPoolConnection) => void
    reject: (err: Error) => void
  }> = []
  private _ended = false
  private sharedEngine: SQLEngine

  constructor(config: PoolOptions | ExtendedMySQLConfig) {
    super()
    this.config = {
      connectionLimit: 10,
      queueLimit: 0,
      waitForConnections: true,
      ...config,
    } as ExtendedMySQLConfig
    // All pool connections share the same engine for consistent state
    this.sharedEngine = createSQLEngine(MYSQL_DIALECT)
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
    values?: any[]
  ): Promise<QueryResult<T>> {
    const connection = await this.getConnection()
    try {
      const result = typeof sqlOrOptions === 'string'
        ? await connection.query<T>(sqlOrOptions, values ?? [])
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
    values?: any[]
  ): Promise<QueryResult<T>> {
    const connection = await this.getConnection()
    try {
      const result = typeof sqlOrOptions === 'string'
        ? await connection.execute<T>(sqlOrOptions, values ?? [])
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
      return connection as unknown as IPoolConnection
    }

    // Create new connection if under limit
    const limit = this.config.connectionLimit ?? 10
    if (this.connections.size < limit) {
      const connection = new MySQLPoolConnection(this.config, this, this.sharedEngine)
      this.connections.add(connection)
      this.emit('connection', connection)
      this.emit('acquire', connection)
      return connection as unknown as IPoolConnection
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

  _releaseConnection(connection: MySQLPoolConnection): void {
    // Check for waiting requests
    if (this.waitingRequests.length > 0) {
      const waiter = this.waitingRequests.shift()!
      this.emit('acquire', connection)
      waiter.resolve(connection as unknown as IPoolConnection)
      return
    }

    // Return to idle pool
    this.idleConnections.push(connection)
    this.emit('release', connection)
  }

  async end(): Promise<void> {
    this._ended = true

    for (const waiter of this.waitingRequests) {
      waiter.reject(new ConnectionError('Pool is closed'))
    }
    this.waitingRequests = []

    const endPromises: Promise<void>[] = []
    for (const connection of this.connections) {
      endPromises.push(connection.end())
    }
    await Promise.all(endPromises)

    this.connections.clear()
    this.idleConnections = []
  }
}

// @ts-expect-error - EventEmitter 'on' method signature differs from mysql2 PoolConnection interface
class MySQLPoolConnection extends MySQLConnection implements IPoolConnection {
  private pool: MySQLPool

  constructor(config: ExtendedMySQLConfig, pool: MySQLPool, sharedEngine: SQLEngine) {
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
  config: ConnectionOptions | ExtendedMySQLConfig
): Promise<IConnection> {
  const connection = new MySQLConnection(config)
  return connection as unknown as IConnection
}

export function createPool(config: PoolOptions | ExtendedMySQLConfig): IPool {
  return new MySQLPool(config) as unknown as IPool
}

// ============================================================================
// EXPORTS
// ============================================================================

export { Types }
export { MySQLError, ConnectionError }

/**
 * Default export matching mysql2/promise module structure
 */
export const mysql = {
  createConnection,
  createPool,
  Types,
  MySQLError,
  ConnectionError,
}

export default mysql
