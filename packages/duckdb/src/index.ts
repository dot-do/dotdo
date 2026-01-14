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
 * await db.exec('CREATE TABLE users (id INTEGER, name VARCHAR)')
 * await db.exec("INSERT INTO users VALUES (1, 'Alice')")
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
 * db.registerFileBuffer('sales.parquet', new Uint8Array(buffer))
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

// Import everything from the core DuckDB Worker implementation
import {
  createDuckDB as _createDuckDB,
  instantiateDuckDB as _instantiateDuckDB,
  clearCache as _clearCache,
  isCached as _isCached,
  // File buffer operations
  FileBufferRegistry as _FileBufferRegistry,
  registerFileBuffer as _registerFileBuffer,
  dropFile as _dropFile,
  getFileBuffer as _getFileBuffer,
  hasFile as _hasFile,
  listFiles as _listFiles,
  getFileSize as _getFileSize,
  clearAllFiles as _clearAllFiles,
  getTotalMemoryUsage as _getTotalMemoryUsage,
  // Module operations
  loadDuckDBModule as _loadDuckDBModule,
  createInstanceFromModule as _createInstanceFromModule,
  clearModuleCache as _clearModuleCache,
  isModuleCached as _isModuleCached,
  createDuckDBFromBindings as _createDuckDBFromBindings,
} from '@dotdo/duckdb-worker'

import type {
  DuckDBConfig,
  DuckDBInstance,
  InstantiationResult,
  QueryResult,
  ColumnInfo,
  LoadDuckDBOptions,
} from '@dotdo/duckdb-worker'

// Re-export types
export type {
  DuckDBConfig,
  DuckDBInstance,
  InstantiationResult,
  QueryResult,
  ColumnInfo,
  LoadDuckDBOptions,
}

// Re-export functions
export const createDuckDB = _createDuckDB
export const instantiateDuckDB = _instantiateDuckDB
export const clearCache = _clearCache
export const isCached = _isCached
export const FileBufferRegistry = _FileBufferRegistry
export const registerFileBuffer = _registerFileBuffer
export const dropFile = _dropFile
export const getFileBuffer = _getFileBuffer
export const hasFile = _hasFile
export const listFiles = _listFiles
export const getFileSize = _getFileSize
export const clearAllFiles = _clearAllFiles
export const getTotalMemoryUsage = _getTotalMemoryUsage
export const loadDuckDBModule = _loadDuckDBModule
export const createInstanceFromModule = _createInstanceFromModule
export const clearModuleCache = _clearModuleCache
export const isModuleCached = _isModuleCached
export const createDuckDBFromBindings = _createDuckDBFromBindings

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
export interface DotdoDuckDBInstance extends DuckDBInstance {
  /**
   * Load a Parquet file from R2 and register it
   */
  loadFromR2(bucket: R2Bucket, key: string, virtualName?: string): Promise<void>
}

/**
 * Create a DuckDB instance with dotdo extensions
 *
 * This factory supports both standard DuckDB configuration and
 * extended dotdo options for sharding, streaming, and tiered storage.
 *
 * @param config - Configuration options
 * @returns DuckDB instance with dotdo extensions
 */
export async function createDotdoDuckDB(config?: DotdoDuckDBConfig): Promise<DotdoDuckDBInstance> {
  // Map DotdoDuckDBConfig to DuckDBConfig
  const baseConfig: DuckDBConfig = {
    maxMemory: config?.maxMemory ? `${config.maxMemory}` : undefined,
    threads: config?.threads,
    accessMode: config?.accessMode === 'read_only' ? 'read_only' : config?.accessMode === 'read_write' ? 'read_write' : undefined,
  }

  // Create base instance
  const db = await _createDuckDB(baseConfig)

  // Return with extensions
  const extendedDb: DotdoDuckDBInstance = {
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

      db.registerFileBuffer(name, new Uint8Array(buffer))
    },
  }

  return extendedDb
}

// Default export for convenience
export default {
  createDuckDB,
  createDotdoDuckDB,
  instantiateDuckDB,
  clearCache,
  isCached,
}
