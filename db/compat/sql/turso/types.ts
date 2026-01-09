/**
 * @dotdo/turso types
 *
 * @libsql/client-compatible type definitions
 * for the Turso/libSQL SDK backed by Durable Objects
 */

// ============================================================================
// VALUE TYPES
// ============================================================================

/**
 * SQLite-compatible value types
 */
export type Value = null | string | number | bigint | ArrayBuffer

/**
 * Input value types (includes JS types that map to SQLite)
 */
export type InValue = Value | boolean | Uint8Array | Date

/**
 * Statement arguments - positional array or named object
 */
export type InArgs = Array<InValue> | Record<string, InValue>

/**
 * Statement to execute - SQL string or object with args
 */
export type InStatement =
  | string
  | { sql: string; args?: InArgs }

/**
 * How to represent SQLite integers
 */
export type IntMode = 'number' | 'bigint' | 'string'

/**
 * Transaction mode
 */
export type TransactionMode = 'write' | 'read' | 'deferred'

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * A single row in a result set
 * Accessible by index (array-like) and by column name (object-like)
 */
export interface Row {
  /** Number of columns */
  readonly length: number
  /** Get value by column index */
  [index: number]: Value
  /** Get value by column name */
  [column: string]: Value
}

/**
 * Result of a query execution
 */
export interface ResultSet {
  /** Column names */
  columns: string[]
  /** Column types (SQLite types) */
  columnTypes: string[]
  /** Result rows */
  rows: Row[]
  /** Number of rows affected by the statement */
  rowsAffected: number
  /** Row ID of the last inserted row */
  lastInsertRowid: bigint | undefined
  /** Convert result to JSON-serializable format */
  toJSON(): Record<string, unknown>
}

/**
 * Replication status for embedded replicas
 */
export interface Replicated {
  frame_no: number
  frames_synced: number
}

// ============================================================================
// CLIENT CONFIG
// ============================================================================

/**
 * Configuration for createClient
 */
export interface Config {
  /** Database URL (libsql:, http:, https:, ws:, wss:, file:) */
  url: string
  /** Auth token for remote databases */
  authToken?: string
  /** Encryption key for encrypted databases */
  encryptionKey?: string
  /** URL for sync (embedded replicas) */
  syncUrl?: string
  /** Automatic sync interval in seconds */
  syncInterval?: number
  /** TLS configuration */
  tls?: boolean
  /** Integer representation mode */
  intMode?: IntMode
  /** Maximum concurrent requests (default: 20) */
  concurrency?: number
}

/**
 * Extended config for DO-backed implementation
 */
export interface ExtendedTursoConfig extends Config {
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
// TRANSACTION
// ============================================================================

/**
 * Interactive transaction handle
 */
export interface Transaction {
  /** Execute a statement within the transaction */
  execute(stmt: InStatement): Promise<ResultSet>
  /** Execute multiple statements in a batch */
  batch(stmts: InStatement[]): Promise<ResultSet[]>
  /** Execute multiple statements (semicolon-separated) */
  executeMultiple(sql: string): Promise<void>
  /** Commit the transaction */
  commit(): Promise<void>
  /** Rollback the transaction */
  rollback(): Promise<void>
  /** Close the transaction (rollback if not committed) */
  close(): void
  /** Whether the transaction is closed */
  readonly closed: boolean
}

// ============================================================================
// CLIENT
// ============================================================================

/**
 * libSQL Client interface
 */
export interface Client {
  /** Execute a single statement */
  execute(stmt: InStatement): Promise<ResultSet>
  /** Execute multiple statements in an implicit transaction */
  batch(stmts: InStatement[], mode?: TransactionMode): Promise<ResultSet[]>
  /** Apply database migrations */
  migrate(stmts: InStatement[]): Promise<ResultSet[]>
  /** Start an interactive transaction */
  transaction(mode?: TransactionMode): Promise<Transaction>
  /** Execute multiple statements (semicolon-separated) */
  executeMultiple(sql: string): Promise<void>
  /** Sync with remote (for embedded replicas) */
  sync(): Promise<Replicated | undefined>
  /** Close the client connection */
  close(): void
  /** Reconnect if using HTTP/WS */
  reconnect?: () => void
  /** Whether the client is closed */
  readonly closed: boolean
  /** Protocol in use */
  readonly protocol: string
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * libSQL error base
 */
export class LibsqlError extends Error {
  code: string
  extendedCode?: number
  rawCode?: number

  constructor(message: string, code: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = 'LibsqlError'
    this.code = code
  }
}

/**
 * Batch error with statement index
 */
export class LibsqlBatchError extends LibsqlError {
  statementIndex: number

  constructor(message: string, code: string, statementIndex: number) {
    super(message, code)
    this.name = 'LibsqlBatchError'
    this.statementIndex = statementIndex
  }
}
