/**
 * @dotdo/neon types
 *
 * @neondatabase/serverless compatible type definitions
 * for the Neon SDK backed by Durable Objects
 *
 * @see https://neon.tech/docs/serverless/serverless-driver
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
 * Full query result set (when fullResults is true)
 */
export interface QueryResult<R = any> {
  /** Array of field descriptions */
  fields: FieldDef[]
  /** Array of result rows */
  rows: R[]
  /** Number of rows affected (INSERT/UPDATE/DELETE) */
  rowCount: number
  /** Command tag (e.g., "SELECT", "INSERT") */
  command: string
  /** OID of inserted row (legacy, usually 0) */
  oid: number
}

// ============================================================================
// NEON OPTIONS
// ============================================================================

/**
 * Options for the neon() function
 */
export interface NeonOptions {
  /** Return full result object instead of just rows */
  fullResults?: boolean
  /** Return rows as arrays instead of objects */
  arrayMode?: boolean
  /** Fetch options to pass to the underlying fetch call */
  fetchOptions?: RequestInit
}

/**
 * Neon configuration options
 */
export interface NeonConfig {
  /** Cache connections for reuse */
  fetchConnectionCache: boolean
  /** Use HTTP fetch for pool queries */
  poolQueryViaFetch: boolean
  /** Custom fetch endpoint function */
  fetchEndpoint?: (host: string, port: number, options?: any) => string
  /** WebSocket proxy URL */
  wsProxy?: string | ((host: string, port: number) => string)
  /** Use secure WebSocket */
  useSecureWebSocket: boolean
  /** Pipeline connect mode */
  pipelineConnect: 'password' | false
  /** Coalesce writes for better performance */
  coalesceWrites: boolean
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
  /** Application name for pg_stat_activity */
  application_name?: string
  /** Connection timeout in milliseconds */
  connectionTimeoutMillis?: number
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
  query<R = any>(text: string, values?: any[]): Promise<QueryResult<R>>

  /** Get a client from the pool */
  connect(): Promise<PoolClient>

  /** End all clients and the pool */
  end(): Promise<void>

  /** Event handlers */
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
  /** Connect to the database */
  connect(): Promise<void>
  connect(callback: (err?: Error) => void): void

  /** Execute a query */
  query<R = any>(text: string, values?: any[]): Promise<QueryResult<R>>

  /** End the client connection */
  end(): Promise<void>
  end(callback: (err?: Error) => void): void

  /** Event handlers */
  on(event: string, handler: (...args: any[]) => void): this
}

// ============================================================================
// SQL FUNCTION TYPES
// ============================================================================

/**
 * Transaction callback function
 */
export type TransactionCallback<T = any> = (
  sql: NeonSqlFunction
) => Promise<T>

/**
 * Neon SQL function with transaction support
 */
export interface NeonSqlFunction {
  /** Template tag query */
  <T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]>
  /** Parameterized query */
  <T = any>(text: string, values?: any[]): Promise<T[]>
  /** Execute transaction with array of queries */
  transaction<T = any>(queries: Promise<any>[]): Promise<T[][]>
  /** Execute transaction with callback */
  transaction<T = any>(callback: TransactionCallback<T>): Promise<T>
}

/**
 * Neon SQL function with fullResults option
 */
export interface NeonSqlFunctionFullResults {
  /** Template tag query */
  <T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<QueryResult<T>>
  /** Parameterized query */
  <T = any>(text: string, values?: any[]): Promise<QueryResult<T>>
  /** Execute transaction with array of queries */
  transaction<T = any>(queries: Promise<any>[]): Promise<QueryResult<T>[]>
  /** Execute transaction with callback */
  transaction<T = any>(callback: TransactionCallback<T>): Promise<T>
}

// ============================================================================
// TYPE PARSING
// ============================================================================

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

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Neon database error
 */
export class NeonDbError extends Error {
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
  /** Source file in PostgreSQL */
  sourceFile?: string
  /** Routine name */
  routine?: string

  constructor(message: string, code: string = 'UNKNOWN', severity: string = 'ERROR') {
    super(message)
    this.name = 'NeonDbError'
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
