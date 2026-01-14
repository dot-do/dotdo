/**
 * @dotdo/postgres - PostgreSQL Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for pg (node-postgres) that runs on Cloudflare Workers
 * using Durable Objects with SQLite storage.
 *
 * Features:
 * - API-compatible with `pg` npm package
 * - Client and Pool classes with full event support
 * - Parameterized queries with $1, $2, ... placeholders
 * - Transaction support (BEGIN/COMMIT/ROLLBACK)
 * - Connection pooling with configurable limits
 * - PostgreSQL-style error handling with SQLSTATE codes
 * - Extended DO routing configuration (sharding, replication)
 *
 * @example Basic Client usage
 * ```typescript
 * import { Client } from '@dotdo/postgres'
 *
 * const client = new Client({
 *   host: 'localhost',
 *   database: 'mydb',
 *   user: 'postgres',
 *   password: 'secret',
 * })
 *
 * await client.connect()
 * const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [1])
 * console.log(rows)
 * await client.end()
 * ```
 *
 * @example Using Pool for connection management
 * ```typescript
 * import { Pool } from '@dotdo/postgres'
 *
 * const pool = new Pool({
 *   connectionString: 'postgres://localhost/mydb',
 *   max: 20,
 * })
 *
 * // Simple query
 * const { rows } = await pool.query('SELECT * FROM users')
 *
 * // Transaction with checkout
 * const client = await pool.connect()
 * try {
 *   await client.query('BEGIN')
 *   await client.query('INSERT INTO users (name) VALUES ($1)', ['Alice'])
 *   await client.query('COMMIT')
 * } catch (e) {
 *   await client.query('ROLLBACK')
 *   throw e
 * } finally {
 *   client.release()
 * }
 *
 * await pool.end()
 * ```
 *
 * @example Extended DO configuration
 * ```typescript
 * import { Pool, ExtendedPostgresConfig } from '@dotdo/postgres'
 *
 * const pool = new Pool({
 *   host: 'localhost',
 *   database: 'mydb',
 *   // Shard across multiple DOs
 *   shard: {
 *     algorithm: 'consistent',
 *     count: 8,
 *     key: 'tenant_id',
 *   },
 *   // Read from replicas
 *   replica: {
 *     readPreference: 'nearest',
 *     jurisdiction: 'eu',
 *   },
 * } as ExtendedPostgresConfig)
 * ```
 *
 * @see https://node-postgres.com/
 */

// Re-export everything from the core implementation
export {
  // Core classes
  Client,
  Pool,
  native,
  // Error classes
  DatabaseError,
  ConnectionError,
  // Type constants
  types,
} from '../../db/compat/sql/postgres/index.js'

// Import for default export
import {
  Client,
  Pool,
  native,
  DatabaseError,
  ConnectionError,
  types,
} from '../../db/compat/sql/postgres/index.js'

// Re-export all types
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
  Pool as IPool,
  // Client types
  ClientConfig,
  Client as IClient,
  // Cursor types
  Cursor,
  // Type parsing
  TypeParser,
  CustomTypesConfig,
  TypeParsers,
  // Extended DO config
  ExtendedPostgresConfig,
} from '../../db/compat/sql/postgres/types.js'

// Extended config type for dotdo-specific features
export interface DotdoPostgresConfig {
  /**
   * Base connection configuration
   */
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  connectionString?: string
  ssl?: boolean | { rejectUnauthorized?: boolean }

  /**
   * Pool configuration
   */
  max?: number
  min?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number

  /**
   * DO namespace binding for Worker deployment
   */
  doNamespace?: unknown // DurableObjectNamespace

  /**
   * Sharding configuration for horizontal scaling
   */
  shard?: {
    /**
     * Sharding algorithm
     * - 'consistent': Consistent hashing (best for key-based routing)
     * - 'range': Range-based sharding (best for ordered data)
     * - 'hash': Simple hash sharding (fastest)
     */
    algorithm?: 'consistent' | 'range' | 'hash'

    /**
     * Number of shards (default: 8)
     */
    count?: number

    /**
     * Field name to shard on (e.g., 'tenant_id', 'user_id')
     */
    key?: string
  }

  /**
   * Replica configuration for read scaling
   */
  replica?: {
    /**
     * Read preference
     * - 'primary': Always read from primary (strongest consistency)
     * - 'secondary': Prefer secondary replicas (better read scaling)
     * - 'nearest': Route to nearest replica (lowest latency)
     */
    readPreference?: 'primary' | 'secondary' | 'nearest'

    /**
     * Write-through to all replicas synchronously
     */
    writeThrough?: boolean

    /**
     * Jurisdiction constraint for data residency
     */
    jurisdiction?: 'eu' | 'us' | 'fedramp'
  }

  /**
   * Tiered storage configuration
   */
  tier?: {
    /**
     * Hot tier (always DO SQLite)
     */
    hot?: 'sqlite'

    /**
     * Warm tier for overflow
     */
    warm?: 'r2'

    /**
     * Cold tier for archived data
     */
    cold?: 'archive'

    /**
     * Threshold before moving to warm tier
     */
    hotThreshold?: string

    /**
     * Age before moving to cold tier
     */
    coldAfter?: string
  }
}

/**
 * Default export matching pg module structure
 */
export default {
  Client,
  Pool,
  types,
  DatabaseError,
  ConnectionError,
  native,
}
