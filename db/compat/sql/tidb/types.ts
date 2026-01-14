/**
 * @dotdo/tidb types
 *
 * mysql2/promise compatible type definitions
 * for the TiDB SDK backed by Durable Objects.
 *
 * TiDB is MySQL wire-protocol compatible, so types are
 * largely identical to mysql2.
 *
 * @see https://docs.pingcap.com/tidb/stable
 * @see https://sidorares.github.io/node-mysql2/docs
 */

// ============================================================================
// VALUE TYPES
// ============================================================================

/**
 * TiDB-compatible value types
 */
export type Value = null | string | number | boolean | Date | Buffer | object

/**
 * Query parameter values - TiDB uses ? placeholders (MySQL style)
 */
export type QueryValue = Value | undefined

/**
 * Query parameters - positional array for ? placeholders
 */
export type QueryParams = QueryValue[]

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Field information returned in query results
 */
export interface FieldPacket {
  /** Column name */
  name: string
  /** Table name */
  table: string
  /** Database name */
  db: string
  /** Original column name (before AS) */
  orgName: string
  /** Original table name */
  orgTable: string
  /** Character set number */
  characterSet: number
  /** Column length */
  columnLength: number
  /** Column type */
  columnType: number
  /** Field flags */
  flags: number
  /** Decimals */
  decimals: number
}

/**
 * Row data packet - single row result
 */
export interface RowDataPacket {
  [column: string]: any
}

/**
 * Result set header for INSERT, UPDATE, DELETE
 */
export interface ResultSetHeader {
  /** Number of affected rows */
  affectedRows: number
  /** Number of changed rows (UPDATE only) */
  changedRows: number
  /** Number of fields */
  fieldCount: number
  /** Auto-generated insert ID */
  insertId: number
  /** Server status */
  serverStatus: number
  /** Warning count */
  warningCount: number
  /** Info message from server */
  info: string
}

/**
 * OK packet result
 */
export interface OkPacket extends ResultSetHeader {
  constructor: {
    name: 'OkPacket'
  }
}

/**
 * Query result tuple - [rows, fields] or [ResultSetHeader, undefined]
 */
export type QueryResult<T = RowDataPacket[]> = [T, FieldPacket[]]

/**
 * Execute result tuple
 */
export type ExecuteResult<T = ResultSetHeader> = [T, FieldPacket[] | undefined]

// ============================================================================
// CONNECTION TYPES
// ============================================================================

/**
 * Connection configuration
 */
export interface ConnectionOptions {
  /** TiDB host */
  host?: string
  /** TiDB port (default: 4000 for TiDB, 3306 for MySQL) */
  port?: number
  /** TiDB user */
  user?: string
  /** TiDB password */
  password?: string
  /** Database name */
  database?: string
  /** Connection string URI */
  uri?: string
  /** Character set */
  charset?: string
  /** Connection timeout in milliseconds */
  connectTimeout?: number
  /** Enable multiple statements */
  multipleStatements?: boolean
  /** SSL configuration */
  ssl?: boolean | {
    rejectUnauthorized?: boolean
    ca?: string | Buffer
    cert?: string | Buffer
    key?: string | Buffer
  }
  /** Socket path */
  socketPath?: string
  /** Enable debug mode */
  debug?: boolean
  /** Enable trace */
  trace?: boolean
  /** Timezone */
  timezone?: string
  /** Date strings */
  dateStrings?: boolean | string[]
  /** Support big numbers */
  supportBigNumbers?: boolean
  /** Big number strings */
  bigNumberStrings?: boolean
  /** Type cast */
  typeCast?: boolean | ((field: any, next: () => void) => any)
  /** Named placeholders */
  namedPlaceholders?: boolean
}

/**
 * Connection interface
 */
export interface Connection {
  /** Thread ID */
  readonly threadId: number | null

  /** Execute a query */
  query<T = RowDataPacket[]>(sql: string): Promise<QueryResult<T>>
  query<T = RowDataPacket[]>(sql: string, values: any[]): Promise<QueryResult<T>>
  query<T = RowDataPacket[]>(options: QueryOptions): Promise<QueryResult<T>>

  /** Execute a prepared statement */
  execute<T = RowDataPacket[]>(sql: string): Promise<QueryResult<T>>
  execute<T = RowDataPacket[]>(sql: string, values: any[]): Promise<QueryResult<T>>
  execute<T = RowDataPacket[]>(options: QueryOptions): Promise<QueryResult<T>>

  /** Begin a transaction */
  beginTransaction(): Promise<void>

  /** Commit a transaction */
  commit(): Promise<void>

  /** Rollback a transaction */
  rollback(): Promise<void>

  /** Ping the server */
  ping(): Promise<void>

  /** Change user */
  changeUser(options: { user?: string; password?: string; database?: string }): Promise<void>

  /** Prepare a statement */
  prepare(sql: string): Promise<PreparedStatementInfo>

  /** Unprepare a statement */
  unprepare(sql: string): void

  /** End the connection */
  end(): Promise<void>

  /** Destroy the connection */
  destroy(): void

  /** Pause the connection */
  pause(): void

  /** Resume the connection */
  resume(): void

  /** Event handlers */
  on(event: 'error', handler: (err: Error) => void): this
  on(event: 'end', handler: () => void): this
  on(event: string, handler: (...args: any[]) => void): this

  /** Remove event listener */
  off(event: string, handler: (...args: any[]) => void): this

  /** Format query with values */
  format(sql: string, values?: any[]): string

  /** Escape a value */
  escape(value: any): string

  /** Escape an identifier */
  escapeId(value: string): string
}

/**
 * Query options
 */
export interface QueryOptions {
  /** SQL query */
  sql: string
  /** Parameter values */
  values?: any[]
  /** Timeout in milliseconds */
  timeout?: number
  /** Row as array */
  rowsAsArray?: boolean
  /** Named placeholders */
  namedPlaceholders?: boolean
  /** Type cast */
  typeCast?: boolean | ((field: any, next: () => void) => any)
}

/**
 * Prepared statement info
 */
export interface PreparedStatementInfo {
  /** Statement ID */
  id: number
  /** Number of parameters */
  parameters: FieldPacket[]
  /** Number of columns */
  columns: FieldPacket[]
  /** Close the statement */
  close(): Promise<void>
  /** Execute the statement */
  execute(values?: any[]): Promise<QueryResult>
}

// ============================================================================
// POOL TYPES
// ============================================================================

/**
 * Pool configuration
 */
export interface PoolOptions extends ConnectionOptions {
  /** Maximum number of connections */
  connectionLimit?: number
  /** Queue limit for waiting connections */
  queueLimit?: number
  /** Wait for connections */
  waitForConnections?: boolean
  /** Enable keep alive */
  enableKeepAlive?: boolean
  /** Keep alive initial delay */
  keepAliveInitialDelay?: number
  /** Maximum idle time in milliseconds */
  maxIdle?: number
  /** Idle timeout in milliseconds */
  idleTimeout?: number
}

/**
 * Pool connection interface
 */
export interface PoolConnection extends Connection {
  /** Connection ID */
  readonly connection: Connection

  /** Release back to pool */
  release(): void
}

/**
 * Pool interface
 */
export interface Pool {
  /** Execute a query using a pooled connection */
  query<T = RowDataPacket[]>(sql: string): Promise<QueryResult<T>>
  query<T = RowDataPacket[]>(sql: string, values: any[]): Promise<QueryResult<T>>
  query<T = RowDataPacket[]>(options: QueryOptions): Promise<QueryResult<T>>

  /** Execute a prepared statement */
  execute<T = RowDataPacket[]>(sql: string): Promise<QueryResult<T>>
  execute<T = RowDataPacket[]>(sql: string, values: any[]): Promise<QueryResult<T>>
  execute<T = RowDataPacket[]>(options: QueryOptions): Promise<QueryResult<T>>

  /** Get a connection from the pool */
  getConnection(): Promise<PoolConnection>

  /** End the pool */
  end(): Promise<void>

  /** Event handlers */
  on(event: 'acquire', handler: (connection: PoolConnection) => void): this
  on(event: 'connection', handler: (connection: PoolConnection) => void): this
  on(event: 'enqueue', handler: () => void): this
  on(event: 'release', handler: (connection: PoolConnection) => void): this
  on(event: 'error', handler: (err: Error) => void): this
  on(event: string, handler: (...args: any[]) => void): this

  /** Pool statistics */
  readonly pool: {
    _allConnections: { length: number }
    _freeConnections: { length: number }
    _connectionQueue: { length: number }
  }
}

// ============================================================================
// EXTENDED DO CONFIG
// ============================================================================

/**
 * Extended config for DO-backed implementation
 */
export interface ExtendedTiDBConfig extends PoolOptions {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Shard configuration */
  shard?: {
    /** Sharding algorithm */
    algorithm?: 'consistent' | 'range' | 'hash'
    /** Number of shards */
    count?: number
    /** Shard key field for routing */
    key?: string
  }
  /** Replica configuration */
  replica?: {
    /** Read preference */
    readPreference?: 'primary' | 'secondary' | 'nearest'
    /** Write-through to all replicas */
    writeThrough?: boolean
    /** Jurisdiction constraint */
    jurisdiction?: 'eu' | 'us' | 'fedramp'
  }
}

// ============================================================================
// MYSQL/TIDB TYPES
// ============================================================================

/**
 * MySQL/TiDB column types
 */
export const Types = {
  DECIMAL: 0,
  TINY: 1,
  SHORT: 2,
  LONG: 3,
  FLOAT: 4,
  DOUBLE: 5,
  NULL: 6,
  TIMESTAMP: 7,
  LONGLONG: 8,
  INT24: 9,
  DATE: 10,
  TIME: 11,
  DATETIME: 12,
  YEAR: 13,
  NEWDATE: 14,
  VARCHAR: 15,
  BIT: 16,
  JSON: 245,
  NEWDECIMAL: 246,
  ENUM: 247,
  SET: 248,
  TINY_BLOB: 249,
  MEDIUM_BLOB: 250,
  LONG_BLOB: 251,
  BLOB: 252,
  VAR_STRING: 253,
  STRING: 254,
  GEOMETRY: 255,
} as const

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * TiDB database error
 */
export class TiDBError extends Error {
  /** Error code */
  code: string
  /** Error number (errno) */
  errno: number
  /** SQL state */
  sqlState?: string
  /** SQL message */
  sqlMessage?: string
  /** Original SQL */
  sql?: string
  /** Fatal error */
  fatal?: boolean

  constructor(message: string, code: string = 'ER_UNKNOWN', errno: number = 1000) {
    super(message)
    this.name = 'Error'
    this.code = code
    this.errno = errno
  }
}

/**
 * Connection error
 */
export class ConnectionError extends TiDBError {
  constructor(message: string) {
    super(message, 'ECONNREFUSED', 1045)
    this.name = 'Error'
    this.fatal = true
  }
}
