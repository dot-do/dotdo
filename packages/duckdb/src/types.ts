/**
 * Type definitions for @dotdo/duckdb
 *
 * Re-exports types from @dotdo/duckdb-worker and adds dotdo-specific types.
 */

// Re-export all types from duckdb-worker
export type {
  DuckDBConfig,
  DuckDBInstance,
  InstantiationResult,
  QueryResult,
  ColumnInfo,
  LoadDuckDBOptions,
} from '@dotdo/duckdb-worker'

// Extended config for dotdo-specific features
export interface DotdoDuckDBConfig {
  /**
   * Base DuckDB configuration
   */
  path?: string
  threads?: number
  maxMemory?: number
  accessMode?: 'read_only' | 'read_write'

  /**
   * Sharding configuration for datasets > 10GB
   */
  shard?: {
    /**
     * Field to shard on (e.g., 'tenant_id', 'date')
     */
    key: string

    /**
     * Number of shards (default: 16)
     */
    count?: number

    /**
     * Sharding algorithm
     */
    algorithm?: 'consistent' | 'range' | 'hash'
  }

  /**
   * Stream writes to pipeline for analytics
   */
  stream?: {
    /**
     * Pipeline binding name
     */
    pipeline: string

    /**
     * Output format
     */
    sink?: 'iceberg' | 'parquet' | 'json'
  }

  /**
   * Tiered storage configuration
   */
  tier?: {
    /**
     * Hot tier storage (always SQLite/DuckDB)
     */
    hot?: 'duckdb'

    /**
     * Warm tier for overflow data
     */
    warm?: 'r2'

    /**
     * Cold tier for archived data
     */
    cold?: 'archive'

    /**
     * Maximum size before moving to warm tier
     */
    hotThreshold?: string

    /**
     * Age before moving to cold tier
     */
    coldAfter?: string
  }

  /**
   * R2 bucket binding for Parquet file access
   */
  r2Bucket?: R2Bucket
}

/**
 * Extended DuckDB instance with R2 helpers
 */
export interface DotdoDuckDBInstance {
  /**
   * Execute SQL that doesn't return results (CREATE, INSERT, etc.)
   */
  exec(sql: string): Promise<void>

  /**
   * Execute a SQL query and return results
   */
  query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[]; columns: string[] }>

  /**
   * Register a file buffer for use in queries (e.g., Parquet files)
   */
  registerFileBuffer(name: string, buffer: Uint8Array): void

  /**
   * Close the database connection
   */
  close(): Promise<void>

  /**
   * Load a Parquet file from R2 and register it
   */
  loadFromR2(bucket: R2Bucket, key: string, virtualName?: string): Promise<void>
}
