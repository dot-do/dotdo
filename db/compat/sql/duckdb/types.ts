/**
 * @dotdo/duckdb types
 *
 * duckdb-node compatible type definitions
 * for the DuckDB SDK backed by Durable Objects
 *
 * @see https://duckdb.org/docs/api/nodejs/reference
 */

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Database access mode
 */
export type AccessMode = 'read_only' | 'read_write'

/**
 * Database configuration options
 */
export interface DatabaseConfig {
  /** Access mode for the database */
  access_mode?: AccessMode
  /** Maximum number of threads */
  threads?: number
  /** Maximum memory usage */
  max_memory?: string
  /** Default null order */
  default_null_order?: 'nulls_first' | 'nulls_last'
  /** Default order direction */
  default_order?: 'asc' | 'desc'
  /** Enable external access */
  enable_external_access?: boolean
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Query execution result (for run operations)
 */
export interface QueryResult {
  /** Number of rows affected */
  changes: number
  /** Last inserted row ID (if applicable) */
  lastInsertRowid?: number | bigint
  /** Column names */
  columns?: string[]
  /** Result rows */
  rows?: unknown[][]
  /** Row count */
  rowCount?: number
  /** Changed rows */
  changedRows?: number
}

/**
 * Column metadata
 */
export interface ColumnInfo {
  /** Column name */
  name: string
  /** Column data type */
  type: string
}

// ============================================================================
// CALLBACK TYPES
// ============================================================================

/**
 * Callback for database open/creation
 */
export type DatabaseCallback = (err: Error | null) => void

/**
 * Callback for close operations
 */
export type CloseCallback = (err: Error | null) => void

/**
 * Callback for run operations
 */
export type RunCallback = (err: Error | null, result?: QueryResult) => void

/**
 * Callback for all operations
 */
export type AllCallback<T = any> = (err: Error | null, rows?: T[]) => void

/**
 * Callback for get operations
 */
export type GetCallback<T = any> = (err: Error | null, row?: T) => void

/**
 * Callback for each row iteration
 */
export type EachRowCallback<T = any> = (err: Error | null, row: T) => void

/**
 * Callback for completion of each iteration
 */
export type EachCompleteCallback = (err: Error | null, rowCount: number) => void

/**
 * Callback for statement finalization
 */
export type FinalizeCallback = (err: Error | null) => void

// ============================================================================
// STATEMENT INTERFACE
// ============================================================================

/**
 * Prepared statement interface
 */
export interface IStatement {
  /** SQL text of the statement */
  readonly sql: string

  /**
   * Bind parameters to the statement
   */
  bind(...params: any[]): this

  /**
   * Execute statement and return all rows
   */
  all<T = any>(...params: any[]): T[]

  /**
   * Execute statement and return first row
   */
  get<T = any>(...params: any[]): T | undefined

  /**
   * Execute statement for side effects
   */
  run(...params: any[]): QueryResult

  /**
   * Finalize and release statement resources
   */
  finalize(callback?: FinalizeCallback): void
}

// ============================================================================
// CONNECTION INTERFACE
// ============================================================================

/**
 * Database connection interface (for async API)
 */
export interface IConnection {
  /**
   * Execute query and return all rows (async)
   */
  all<T = any>(sql: string, params?: any[]): Promise<T[]>

  /**
   * Execute query and return first row (async)
   */
  get<T = any>(sql: string, params?: any[]): Promise<T | undefined>

  /**
   * Execute statement for side effects (async)
   */
  run(sql: string, params?: any[]): Promise<QueryResult>

  /**
   * Prepare a statement (async)
   */
  prepare(sql: string): Promise<IStatement>

  /**
   * Close the connection
   */
  close(): Promise<void>
}

// ============================================================================
// DATABASE INTERFACE
// ============================================================================

/**
 * Main database interface
 */
export interface IDatabase {
  /** Database path */
  readonly path: string

  /** Whether database is open */
  readonly open: boolean

  /**
   * Execute SQL and return all rows
   */
  all<T = any>(sql: string, callback?: AllCallback<T>): T[]
  all<T = any>(sql: string, params: any[], callback?: AllCallback<T>): T[]

  /**
   * Execute SQL and return first row
   */
  get<T = any>(sql: string, callback?: GetCallback<T>): T | undefined
  get<T = any>(sql: string, params: any[], callback?: GetCallback<T>): T | undefined

  /**
   * Execute SQL for side effects (DDL/DML)
   */
  run(sql: string, callback?: RunCallback): QueryResult
  run(sql: string, params: any[], callback?: RunCallback): QueryResult

  /**
   * Execute SQL and call callback for each row
   */
  each<T = any>(
    sql: string,
    callback: EachRowCallback<T>,
    complete?: EachCompleteCallback
  ): void
  each<T = any>(
    sql: string,
    params: any[],
    callback: EachRowCallback<T>,
    complete?: EachCompleteCallback
  ): void

  /**
   * Prepare a statement for repeated execution
   */
  prepare(sql: string): IStatement

  /**
   * Create a new connection (async API)
   */
  connect(): Promise<IConnection>

  /**
   * Close the database
   */
  close(callback?: CloseCallback): void
  close(force: boolean, callback?: CloseCallback): void
}

// ============================================================================
// EXTENDED DO CONFIG
// ============================================================================

/**
 * Extended config for DO-backed implementation
 */
export interface ExtendedDuckDBConfig extends DatabaseConfig {
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
 * DuckDB error
 */
export class DuckDBError extends Error {
  /** Error code */
  code?: string
  /** SQL that caused the error */
  sql?: string

  constructor(message: string, code?: string, sql?: string) {
    super(message)
    this.name = 'DuckDBError'
    this.code = code
    this.sql = sql
  }
}
