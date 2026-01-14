/**
 * @dotdo/duckdb - DuckDB Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for duckdb-node that runs on Cloudflare Workers
 * using Durable Objects with SQLite storage, Parquet on R2, and
 * distributed sharding for horizontal scaling.
 *
 * Features:
 * - API-compatible with `duckdb` npm package
 * - Database, Connection, and Statement classes
 * - Parquet file reading from R2
 * - Distributed query routing across shards
 * - Memory-only mode for testing
 * - Arrow format support
 *
 * @example Basic usage
 * ```typescript
 * import { Database } from '@dotdo/duckdb'
 *
 * const db = new Database(':memory:')
 * db.run('CREATE TABLE test (id INTEGER, name TEXT)')
 * db.run("INSERT INTO test VALUES (1, 'Alice'), (2, 'Bob')")
 *
 * const rows = db.all('SELECT * FROM test')
 * console.log(rows)
 *
 * db.close()
 * ```
 *
 * @example Async API with Connection
 * ```typescript
 * import { open } from '@dotdo/duckdb'
 *
 * const db = await open(':memory:')
 * const conn = await db.connect()
 *
 * await conn.run('CREATE TABLE users (id INTEGER, email TEXT)')
 * const users = await conn.all('SELECT * FROM users')
 *
 * await conn.close()
 * await db.close()
 * ```
 *
 * @example Extended DO configuration (sharding)
 * ```typescript
 * import { Database, ExtendedDuckDBConfig } from '@dotdo/duckdb'
 *
 * const db = new Database(':memory:', {
 *   shard: {
 *     algorithm: 'consistent',
 *     count: 8,
 *     key: 'tenant_id',
 *   },
 *   replica: {
 *     readPreference: 'nearest',
 *     jurisdiction: 'eu',
 *   },
 * } as ExtendedDuckDBConfig)
 * ```
 *
 * @see https://duckdb.org/docs/api/nodejs/reference
 */

// Re-export everything from the core implementation
export {
  Database,
  Connection,
  Statement,
  DuckDBError,
  open,
  default as DuckDB,
} from '../../db/compat/sql/duckdb/duckdb'

// Re-export all types
export type {
  IDatabase,
  IConnection,
  IStatement,
  DatabaseConfig,
  ExtendedDuckDBConfig,
  QueryResult,
  ColumnInfo,
  AccessMode,
  DatabaseCallback,
  CloseCallback,
  RunCallback,
  AllCallback,
  GetCallback,
  EachRowCallback,
  EachCompleteCallback,
  FinalizeCallback,
} from '../../db/compat/sql/duckdb/types'

// Import for default export
import {
  Database,
  Connection,
  Statement,
  DuckDBError,
  open,
} from '../../db/compat/sql/duckdb/duckdb'

/**
 * Extended config for dotdo-specific features
 */
export interface DotdoDuckDBConfig {
  /**
   * R2 bucket for Parquet file storage
   */
  r2Bucket?: R2Bucket

  /**
   * DO namespace binding for Worker deployment
   */
  doNamespace?: DurableObjectNamespace

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
   * Memory configuration
   */
  maxMemory?: string
}

/**
 * Default export matching duckdb module structure
 */
export default {
  Database,
  Connection,
  Statement,
  DuckDBError,
  open,
}
