/**
 * @dotdo/cockroach types
 *
 * CockroachDB SDK compatible type definitions
 * for the CockroachDB compat layer backed by Durable Objects.
 *
 * CockroachDB is PostgreSQL wire-protocol compatible, so many types
 * are inherited from the postgres compat layer.
 *
 * @see https://www.cockroachlabs.com/docs/
 */

// Re-export base PostgreSQL types
export type {
  // Value types
  Value,
  QueryValue,
  QueryParams,

  // Result types
  FieldDef,
  QueryResult,
  QueryArrayResult,

  // Query types
  QueryConfig,
  Submittable,
  Query,

  // Notification types
  Notification,

  // Connection types
  ConnectionConfig,
  TLSConfig,
  Connection,

  // Pool types
  PoolConfig,
  PoolClient,
  Pool,

  // Client types
  ClientConfig,
  Client,

  // Cursor types
  Cursor,

  // Type parsing
  TypeParser,
  CustomTypesConfig,
  TypeParsers,
} from '../postgres/types'

export { DatabaseError, ConnectionError, types } from '../postgres/types'

// ============================================================================
// COCKROACHDB-SPECIFIC TYPES
// ============================================================================

/**
 * CockroachDB-specific transaction isolation levels
 */
export type IsolationLevel = 'SERIALIZABLE' | 'READ COMMITTED' | 'REPEATABLE READ'

/**
 * CockroachDB-specific transaction options
 */
export interface TransactionOptions {
  /** Isolation level (default: SERIALIZABLE) */
  isolationLevel?: IsolationLevel
  /** Read-only transaction */
  readOnly?: boolean
  /** AS OF SYSTEM TIME for historical reads */
  asOfSystemTime?: string | Date
  /** Transaction priority */
  priority?: 'LOW' | 'NORMAL' | 'HIGH'
}

/**
 * AS OF SYSTEM TIME configuration
 */
export interface AsOfSystemTimeConfig {
  /** Interval string like '-10s' or '-1h' */
  interval?: string
  /** Explicit timestamp */
  timestamp?: Date | string
  /** Use follower_read_timestamp() */
  followerRead?: boolean
}

/**
 * Extended CockroachDB configuration
 */
export interface CockroachConfig {
  /** PostgreSQL username */
  user?: string
  /** PostgreSQL password */
  password?: string | (() => string | Promise<string>)
  /** Database host */
  host?: string
  /** Database name */
  database?: string
  /** Connection port (default: 26257 for CRDB) */
  port?: number
  /** Connection string (overrides other options) */
  connectionString?: string
  /** Use SSL/TLS */
  ssl?: boolean | {
    rejectUnauthorized?: boolean
    ca?: string | Buffer | Array<string | Buffer>
    key?: string | Buffer
    cert?: string | Buffer
  }
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

  // CockroachDB-specific options

  /** CockroachDB cluster identifier (for serverless) */
  cluster?: string
  /** Default transaction isolation level */
  defaultIsolationLevel?: IsolationLevel

  // Pool options
  /** Maximum number of clients in the pool */
  max?: number
  /** Minimum number of clients in the pool */
  min?: number
  /** Idle timeout in milliseconds */
  idleTimeoutMillis?: number
  /** Max uses per client before release */
  maxUses?: number
  /** Allow exit when pool is idle */
  allowExitOnIdle?: boolean

  // DO-specific options

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
