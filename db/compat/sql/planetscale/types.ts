/**
 * @dotdo/planetscale types
 *
 * @planetscale/database compatible type definitions
 * for the PlanetScale SDK backed by Durable Objects
 *
 * @see https://github.com/planetscale/database-js
 */

// ============================================================================
// CONFIG TYPES
// ============================================================================

/**
 * Connection configuration for PlanetScale
 */
export interface Config {
  /** PlanetScale host (e.g., aws.connect.psdb.cloud) */
  host?: string
  /** Database username */
  username?: string
  /** Database password */
  password?: string
  /** Connection URL (alternative to host/username/password) */
  url?: string
  /** Custom fetch function for HTTP requests */
  fetch?: typeof fetch
  /** Response format */
  format?: 'json' | 'array'
  /** Enable query caching (PlanetScale Boost) */
  boost?: boolean

  // Extended DO config
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
// RESULT TYPES
// ============================================================================

/**
 * Result of an executed query
 */
export interface ExecutedQuery<T = Row> {
  /** Column headers (names) */
  headers: string[]
  /** Row data as array of objects */
  rows: T[]
  /** Number of rows returned */
  size: number
  /** Execution time in milliseconds */
  time: number
  /** Last insert ID (for INSERT with AUTO_INCREMENT) */
  insertId?: number | string
  /** Number of rows affected (for INSERT/UPDATE/DELETE) */
  rowsAffected?: number
}

/**
 * Generic row type
 */
export interface Row {
  [column: string]: unknown
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

/**
 * Transaction context for executing queries atomically
 */
export interface Transaction {
  /**
   * Execute a query within the transaction
   */
  execute<T = Row>(sql: string, args?: unknown[]): Promise<ExecutedQuery<T>>
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Database error from PlanetScale
 */
export class DatabaseError extends Error {
  /** Error code */
  code: string
  /** HTTP status (for HTTP-level errors) */
  status?: number
  /** Error body from server */
  body?: unknown

  constructor(message: string, code: string = 'UNKNOWN', status?: number) {
    super(message)
    this.name = 'DatabaseError'
    this.code = code
    this.status = status
  }
}
