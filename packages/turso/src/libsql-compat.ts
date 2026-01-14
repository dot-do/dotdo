/**
 * @dotdo/turso libsql-client API Compatibility Layer
 *
 * This module provides type definitions and stub implementations
 * for libsql-client API compatibility.
 *
 * Reference: https://github.com/tursodatabase/libsql-client-ts
 *
 * RED Phase: These are stub implementations that will fail tests.
 * GREEN Phase will provide actual implementations.
 */

// ============================================================================
// Value Types
// ============================================================================

/**
 * Value types that can be stored in SQLite/libSQL
 */
export type Value = null | string | number | bigint | Uint8Array

/**
 * Input value types (broader than stored values for convenience)
 */
export type InValue =
  | Value
  | boolean
  | undefined
  | ArrayBuffer
  | Date

// ============================================================================
// Row and ResultSet Types
// ============================================================================

/**
 * A row from a query result
 * Supports both index-based and named access
 */
export type Row = Record<string, Value> & {
  [index: number]: Value
  length: number
}

/**
 * Result of executing a SQL statement
 */
export interface ResultSet {
  /** Column names in order */
  columns: string[]
  /** Array of rows */
  rows: Row[]
  /** Number of rows affected by the statement (for INSERT/UPDATE/DELETE) */
  rowsAffected: number
  /** Row ID of the last inserted row */
  lastInsertRowid?: bigint
  /** Column types (optional) */
  columnTypes?: string[]
}

// ============================================================================
// Statement Types
// ============================================================================

/**
 * Input statement - can be a string or object with sql and args
 */
export type InStatement =
  | string
  | {
      sql: string
      args?: InValue[] | Record<string, InValue>
    }

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * Transaction mode for batch and transaction operations
 * - 'deferred': Default mode, deferred transaction (BEGIN DEFERRED)
 * - 'write': Read-write transaction (BEGIN IMMEDIATE)
 * - 'read': Read-only transaction (BEGIN TRANSACTION READONLY)
 */
export type TransactionMode = 'read' | 'write' | 'deferred'

/**
 * Interactive transaction interface
 */
export interface Transaction {
  /**
   * Execute a single SQL statement within the transaction
   */
  execute(stmt: InStatement): Promise<ResultSet>

  /**
   * Execute multiple statements within the transaction
   */
  batch(stmts: InStatement[]): Promise<ResultSet[]>

  /**
   * Commit the transaction
   */
  commit(): Promise<void>

  /**
   * Rollback the transaction
   */
  rollback(): Promise<void>

  /**
   * Close the transaction (rolls back if not committed)
   */
  close(): Promise<void>

  /**
   * Whether the transaction is closed
   */
  readonly closed: boolean
}

// ============================================================================
// Client Configuration
// ============================================================================

/**
 * Configuration for creating a libsql client
 */
export interface Config {
  /**
   * Database URL
   * Supported protocols:
   * - libsql:// - Turso cloud database
   * - http:// / https:// - HTTP connection
   * - ws:// / wss:// - WebSocket connection
   * - file: - Local file database
   * - :memory: - In-memory database
   */
  url: string

  /**
   * Authentication token for remote databases
   */
  authToken?: string

  /**
   * URL for remote database to sync with (embedded replicas)
   */
  syncUrl?: string

  /**
   * Interval in seconds for automatic sync (embedded replicas)
   */
  syncInterval?: number

  /**
   * Encryption key for encrypted databases
   */
  encryptionKey?: string

  /**
   * Fetch implementation for HTTP connections
   */
  fetch?: typeof fetch

  /**
   * Custom TLS configuration
   */
  tls?: boolean

  /**
   * Concurrency limit for WebSocket connections
   */
  concurrency?: number
}

// ============================================================================
// Client Interface
// ============================================================================

/**
 * libsql-client compatible database client
 */
export interface Client {
  /**
   * Execute a single SQL statement
   */
  execute(stmt: InStatement): Promise<ResultSet>

  /**
   * Execute multiple SQL statements in a transaction
   * @param stmts Array of statements to execute
   * @param mode Transaction mode (default: 'deferred')
   */
  batch(stmts: InStatement[], mode?: TransactionMode): Promise<ResultSet[]>

  /**
   * Begin an interactive transaction
   * @param mode Transaction mode (default: 'deferred')
   */
  transaction(mode?: TransactionMode): Promise<Transaction>

  /**
   * Close the client and release resources
   */
  close(): Promise<void>

  /**
   * Sync with remote database (embedded replicas only)
   */
  sync?(): Promise<void>

  /**
   * Whether the client is closed
   */
  readonly closed: boolean
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error class for libsql errors
 */
export class LibsqlError extends Error {
  /** Error code */
  code: string
  /** Raw error code from SQLite */
  rawCode?: number

  constructor(message: string, code: string, rawCode?: number) {
    super(message)
    this.name = 'LibsqlError'
    this.code = code
    this.rawCode = rawCode
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a libsql-client compatible database client
 *
 * @param config - Client configuration
 * @returns A Client instance
 *
 * @example
 * ```typescript
 * import { createClient } from '@dotdo/turso'
 *
 * const client = createClient({
 *   url: 'libsql://my-database.turso.io',
 *   authToken: 'your-auth-token'
 * })
 *
 * const result = await client.execute('SELECT * FROM users')
 * ```
 */
export function createClient(_config: Config): Client {
  // RED Phase: Throw error to make tests fail
  // GREEN Phase: Implement actual client
  throw new Error(
    'createClient() is not yet implemented. ' +
    'This is a RED phase stub - implementation coming in GREEN phase.'
  )
}
