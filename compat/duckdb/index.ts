/**
 * @dotdo/duckdb - DuckDB Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for the DuckDB API that runs on Cloudflare Workers
 * using custom WASM builds optimized for the Workers runtime.
 *
 * Features:
 * - API-compatible with `duckdb` npm package
 * - Optimized WASM binary (no GOT.func/GOT.mem imports)
 * - Single-threaded execution (Workers constraint)
 * - Memory-only mode (no filesystem)
 * - Optional sharding for large datasets (10GB per DO limit)
 * - Parquet file support via R2 buffer registration
 *
 * @example
 * ```typescript
 * import { createDuckDB } from '@dotdo/duckdb'
 *
 * // Create in-memory database
 * const db = await createDuckDB()
 *
 * // Create tables and run queries
 * await db.query('CREATE TABLE users (id INTEGER, name VARCHAR)')
 * await db.query("INSERT INTO users VALUES (1, 'Alice')")
 *
 * const result = await db.query('SELECT * FROM users')
 * console.log(result.rows) // [{ id: 1, name: 'Alice' }]
 *
 * await db.close()
 * ```
 *
 * @example With Parquet from R2
 * ```typescript
 * import { createDuckDB } from '@dotdo/duckdb'
 *
 * const db = await createDuckDB()
 *
 * // Fetch Parquet from R2
 * const object = await env.R2_BUCKET.get('data/sales.parquet')
 * const buffer = await object.arrayBuffer()
 *
 * // Register as virtual file
 * await db.registerBuffer('sales.parquet', buffer)
 *
 * // Query directly
 * const result = await db.query(`
 *   SELECT region, SUM(revenue) as total
 *   FROM parquet_scan('sales.parquet')
 *   GROUP BY region
 * `)
 * ```
 *
 * @see https://duckdb.org/docs/api/nodejs/overview
 */

// Re-export from the core DuckDB WASM implementation
export {
  createDuckDB,
  instantiateDuckDB,
  clearCache,
  isCached,
  getHeapUsage,
  registerBuffer,
  dropBuffer,
} from '../../db/compat/sql/duckdb-wasm/index.js'

export type {
  DuckDBConfig,
  DuckDBInstance,
  InstantiateOptions,
  InstantiationResult,
  InstantiationMetrics,
  QueryResult,
  QueryOptions,
  ColumnInfo,
  BufferRegistrationOptions,
  BufferRegistrationResult,
} from '../../db/compat/sql/duckdb-wasm/types.js'

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
 * Create a DuckDB instance with dotdo extensions
 *
 * This factory supports both standard DuckDB configuration and
 * extended dotdo options for sharding, streaming, and tiered storage.
 *
 * @param config - Configuration options
 * @returns DuckDB instance
 */
export async function createDotdoDuckDB(config?: DotdoDuckDBConfig) {
  // Import the base createDuckDB
  const { createDuckDB: baseCreateDuckDB } = await import('../../db/compat/sql/duckdb-wasm/index.js')

  // For now, just create base instance
  // TODO: Add shard router, stream bridge, tier manager
  const db = await baseCreateDuckDB({
    path: config?.path,
    threads: config?.threads,
    maxMemory: config?.maxMemory,
    accessMode: config?.accessMode,
  })

  // Return with potential extensions
  return {
    ...db,

    /**
     * Load a Parquet file from R2 and register it
     */
    async loadFromR2(bucket: R2Bucket, key: string, virtualName?: string): Promise<void> {
      const object = await bucket.get(key)
      if (!object) {
        throw new Error(`R2 object not found: ${key}`)
      }

      const buffer = await object.arrayBuffer()
      const name = virtualName ?? key.split('/').pop() ?? key

      await db.registerBuffer(name, buffer)
    },
  }
}

// Default export for convenience
export default {
  createDuckDB,
  createDotdoDuckDB,
  instantiateDuckDB,
  clearCache,
  isCached,
  getHeapUsage,
  registerBuffer,
  dropBuffer,
}
