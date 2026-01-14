/**
 * @dotdo/postgres types
 *
 * pg (node-postgres) compatible type definitions
 * for the PostgreSQL SDK backed by Durable Objects
 *
 * @see https://node-postgres.com/apis
 */

// ============================================================================
// VALUE TYPES
// ============================================================================

/**
 * PostgreSQL-compatible value types
 */
export type Value = null | string | number | boolean | Date | Buffer | object

/**
 * Query parameter values
 */
export type QueryValue = Value | undefined

/**
 * Query parameters - positional array
 */
export type QueryParams = QueryValue[]

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Field description returned in query results
 */
export interface FieldDef {
  /** Column name */
  name: string
  /** Table OID (simulated) */
  tableID: number
  /** Column number within table */
  columnID: number
  /** Data type OID */
  dataTypeID: number
  /** Data type size */
  dataTypeSize: number
  /** Data type modifier */
  dataTypeModifier: number
  /** Format code (0 = text, 1 = binary) */
  format: string
}

/**
 * Query result set
 */
export interface QueryResult<R = any> {
  /** Array of field descriptions */
  fields: FieldDef[]
  /** Array of result rows */
  rows: R[]
  /** Number of rows affected (INSERT/UPDATE/DELETE) */
  rowCount: number
  /** Command tag (e.g., "SELECT 2", "INSERT 0 1") */
  command: string
  /** OID of inserted row (legacy, usually 0) */
  oid: number
}

/**
 * Query result for multiple statements
 */
export interface QueryArrayResult<R = any[]> extends QueryResult<R> {
  /** Access rows as arrays instead of objects */
  rows: R[]
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query configuration object
 */
export interface QueryConfig<I = any[]> {
  /** SQL query string */
  text: string
  /** Query parameters */
  values?: I
  /** Query name for prepared statements */
  name?: string
  /** Row mode: 'array' returns arrays, otherwise objects */
  rowMode?: 'array'
  /** Custom type parsers */
  types?: CustomTypesConfig
}

/**
 * Submittable interface for custom queries
 */
export interface Submittable {
  submit(connection: Connection): void
}

/**
 * Query object with result streaming
 */
export interface Query<R = any> extends Submittable {
  /** SQL text */
  text: string
  /** Parameter values */
  values?: any[]

  /** Event handlers */
  on(event: 'row', handler: (row: R, result: QueryResult<R>) => void): this
  on(event: 'error', handler: (err: Error) => void): this
  on(event: 'end', handler: (result: QueryResult<R>) => void): this
  on(event: string, handler: (...args: any[]) => void): this
}

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

/**
 * NOTIFY/LISTEN notification
 */
export interface Notification {
  /** Process ID of notifying backend */
  processId: number
  /** Channel name */
  channel: string
  /** Notification payload */
  payload?: string
}

// ============================================================================
// CONNECTION TYPES
// ============================================================================

/**
 * Connection configuration
 */
export interface ConnectionConfig {
  /** PostgreSQL username */
  user?: string
  /** PostgreSQL password */
  password?: string | (() => string | Promise<string>)
  /** Database host */
  host?: string
  /** Database name */
  database?: string
  /** Connection port */
  port?: number
  /** Connection string (overrides other options) */
  connectionString?: string
  /** Use SSL/TLS */
  ssl?: boolean | TLSConfig
  /** Statement timeout in milliseconds */
  statement_timeout?: number
  /** Query timeout in milliseconds */
  query_timeout?: number
  /** Lock timeout in milliseconds */
  lock_timeout?: number
  /** Idle in transaction session timeout */
  idle_in_transaction_session_timeout?: number
  /** Application name for pg_stat_activity */
  application_name?: string
  /** Connection timeout in milliseconds */
  connectionTimeoutMillis?: number
  /** Keep alive */
  keepAlive?: boolean
  /** Keep alive initial delay in milliseconds */
  keepAliveInitialDelayMillis?: number
}

/**
 * TLS/SSL configuration
 */
export interface TLSConfig {
  /** Reject unauthorized connections */
  rejectUnauthorized?: boolean
  /** CA certificates */
  ca?: string | Buffer | Array<string | Buffer>
  /** Client key */
  key?: string | Buffer
  /** Client certificate */
  cert?: string | Buffer
}

/**
 * Connection interface (internal)
 */
export interface Connection {
  /** Process ID */
  processID: number
  /** Secret key */
  secretKey: number
  /** Send query */
  query(text: string): void
  /** Parse prepared statement */
  parse(config: { name?: string; text: string; types?: number[] }): void
  /** Bind parameters */
  bind(config: { portal?: string; statement?: string; values?: any[] }): void
  /** Execute query */
  execute(config: { portal?: string; rows?: number }): void
  /** Sync */
  sync(): void
  /** Close */
  close(config: { type: 'P' | 'S'; name?: string }): void
  /** End connection */
  end(): void
}

// ============================================================================
// POOL TYPES
// ============================================================================

/**
 * Pool configuration
 */
export interface PoolConfig extends ConnectionConfig {
  /** Maximum number of clients in the pool */
  max?: number
  /** Minimum number of clients in the pool */
  min?: number
  /** Idle timeout in milliseconds */
  idleTimeoutMillis?: number
  /** How long to wait for a client */
  connectionTimeoutMillis?: number
  /** Max uses per client before release */
  maxUses?: number
  /** Allow exit when pool is idle */
  allowExitOnIdle?: boolean
}

/**
 * Pool client - a client checked out from a pool
 */
export interface PoolClient extends Client {
  /** Release client back to pool */
  release(destroy?: boolean): void
}

/**
 * Pool interface
 */
export interface Pool {
  /** Number of total clients */
  totalCount: number
  /** Number of idle clients */
  idleCount: number
  /** Number of clients waiting for connection */
  waitingCount: number
  /** Pool is ended */
  readonly ended: boolean

  /** Execute a query using a client from the pool */
  query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: I
  ): Promise<QueryResult<R>>

  /** Get a client from the pool */
  connect(): Promise<PoolClient>

  /** End all clients and the pool */
  end(): Promise<void>

  /** Event handlers */
  on(event: 'connect', handler: (client: PoolClient) => void): this
  on(event: 'acquire', handler: (client: PoolClient) => void): this
  on(event: 'release', handler: (err: Error | undefined, client: PoolClient) => void): this
  on(event: 'remove', handler: (client: PoolClient) => void): this
  on(event: 'error', handler: (err: Error, client: PoolClient) => void): this
  on(event: string, handler: (...args: any[]) => void): this
}

// ============================================================================
// CLIENT TYPES
// ============================================================================

/**
 * Client configuration extends connection config
 */
export interface ClientConfig extends ConnectionConfig {}

/**
 * PostgreSQL Client interface
 */
export interface Client {
  /** Connection configuration */
  readonly connectionParameters: ConnectionConfig
  /** Process ID from PostgreSQL */
  readonly processID: number | null
  /** Secret key for cancel requests */
  readonly secretKey: number | null

  /** Connect to the database */
  connect(): Promise<void>
  connect(callback: (err?: Error) => void): void

  /** Execute a query */
  query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: I
  ): Promise<QueryResult<R>>
  query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    callback: (err: Error | null, result: QueryResult<R>) => void
  ): void
  query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values: I,
    callback: (err: Error | null, result: QueryResult<R>) => void
  ): void

  /** End the client connection */
  end(): Promise<void>
  end(callback: (err?: Error) => void): void

  /** Event handlers */
  on(event: 'connect', handler: () => void): this
  on(event: 'end', handler: () => void): this
  on(event: 'error', handler: (err: Error) => void): this
  on(event: 'notice', handler: (notice: any) => void): this
  on(event: 'notification', handler: (notification: Notification) => void): this
  on(event: string, handler: (...args: any[]) => void): this

  /** Remove event listener */
  off(event: string, handler: (...args: any[]) => void): this
  removeListener(event: string, handler: (...args: any[]) => void): this

  /** Copy operations (not implemented in in-memory version) */
  copyFrom(queryText: string): any
  copyTo(queryText: string): any

  /** Pause drain on the connection */
  pauseDrain(): void
  /** Resume drain on the connection */
  resumeDrain(): void

  /** Escape literal for safe SQL inclusion */
  escapeLiteral(value: string): string
  /** Escape identifier for safe SQL inclusion */
  escapeIdentifier(value: string): string
}

// ============================================================================
// CURSOR TYPES
// ============================================================================

/**
 * Cursor for iterating through large result sets
 */
export interface Cursor<R = any> {
  /** Read n rows from the cursor */
  read(rowCount: number): Promise<R[]>
  read(rowCount: number, callback: (err: Error | null, rows: R[]) => void): void

  /** Close the cursor */
  close(): Promise<void>
  close(callback: (err: Error | null) => void): void
}

// ============================================================================
// TYPE PARSING
// ============================================================================

/**
 * Custom type parser
 */
export interface TypeParser {
  (value: string): any
}

/**
 * Custom types configuration
 */
export interface CustomTypesConfig {
  getTypeParser(oid: number, format?: string): TypeParser
}

/**
 * Type OIDs (subset of common types)
 */
export const types = {
  BOOL: 16,
  BYTEA: 17,
  CHAR: 18,
  INT8: 20,
  INT2: 21,
  INT4: 23,
  TEXT: 25,
  OID: 26,
  JSON: 114,
  FLOAT4: 700,
  FLOAT8: 701,
  MONEY: 790,
  VARCHAR: 1043,
  DATE: 1082,
  TIME: 1083,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  INTERVAL: 1186,
  NUMERIC: 1700,
  UUID: 2950,
  JSONB: 3802,
} as const

/**
 * Type parsers registry
 */
export interface TypeParsers {
  setTypeParser(oid: number, format: string | TypeParser, parser?: TypeParser): void
  getTypeParser(oid: number, format?: string): TypeParser
}

// ============================================================================
// EXTENDED DO CONFIG
// ============================================================================

/**
 * Extended config for DO-backed implementation
 */
export interface ExtendedPostgresConfig extends PoolConfig {
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
// ERROR TYPES
// ============================================================================

/**
 * PostgreSQL database error
 */
export class DatabaseError extends Error {
  /** Error severity */
  severity: string
  /** PostgreSQL error code (SQLSTATE) */
  code: string
  /** Detail message */
  detail?: string
  /** Hint message */
  hint?: string
  /** Position in query where error occurred */
  position?: string
  /** Internal query position */
  internalPosition?: string
  /** Internal query text */
  internalQuery?: string
  /** Where in query */
  where?: string
  /** Schema name */
  schema?: string
  /** Table name */
  table?: string
  /** Column name */
  column?: string
  /** Data type name */
  dataType?: string
  /** Constraint name */
  constraint?: string
  /** Source file in PostgreSQL */
  file?: string
  /** Line in source file */
  line?: string
  /** Routine name */
  routine?: string

  constructor(message: string, code: string, severity: string = 'ERROR') {
    super(message)
    this.name = 'DatabaseError'
    this.code = code
    this.severity = severity
  }
}

/**
 * Connection error
 */
export class ConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}
