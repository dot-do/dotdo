/**
 * Type definitions for DuckDB WASM integration
 *
 * @module @dotdo/duckdb-wasm/types
 */

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Configuration options for DuckDB instantiation
 */
export interface DuckDBConfig {
  /**
   * Database path - use ':memory:' for in-memory database
   * @default ':memory:'
   */
  path?: string

  /**
   * Custom path to WASM binary (for testing/advanced use)
   */
  wasmPath?: string

  /**
   * Enable threading via SharedArrayBuffer (if available)
   * @default false
   */
  useThreads?: boolean

  /**
   * Maximum memory allocation in bytes
   * @default 100 * 1024 * 1024 (100MB)
   */
  maxMemory?: number
}

/**
 * Options for instantiation with metrics
 */
export interface InstantiateOptions {
  /**
   * Whether to measure and return performance metrics
   */
  measureMetrics?: boolean
}

// ============================================================================
// METRICS TYPES
// ============================================================================

/**
 * Performance metrics from DuckDB instantiation
 */
export interface InstantiationMetrics {
  /**
   * Total time to instantiate DuckDB in milliseconds
   */
  instantiationTimeMs: number

  /**
   * Time spent compiling WASM module in milliseconds
   */
  compilationTimeMs: number

  /**
   * Time spent initializing database in milliseconds
   */
  initializationTimeMs: number

  /**
   * Peak memory usage during instantiation in bytes
   */
  peakMemoryBytes: number

  /**
   * Size of the WASM module in bytes
   */
  wasmModuleSizeBytes: number

  /**
   * Current heap memory usage in bytes
   */
  heapUsedBytes: number
}

/**
 * Result from WASM instantiation
 */
export interface InstantiationResult {
  /**
   * Whether instantiation succeeded
   */
  success: boolean

  /**
   * Error if instantiation failed
   */
  error?: Error

  /**
   * Performance metrics (if measureMetrics was true)
   */
  metrics?: InstantiationMetrics
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Column metadata from query result
 */
export interface ColumnInfo {
  /**
   * Column name
   */
  name: string

  /**
   * DuckDB type name
   */
  type: string
}

/**
 * Result from a query execution
 */
export interface QueryResult<T = Record<string, unknown>> {
  /**
   * Array of result rows
   */
  rows: T[]

  /**
   * Column metadata
   */
  columns: ColumnInfo[]

  /**
   * Number of rows affected (for INSERT/UPDATE/DELETE)
   */
  rowsAffected?: number
}

/**
 * Query execution options
 */
export interface QueryOptions {
  /**
   * AbortSignal for canceling long-running queries
   */
  signal?: AbortSignal
}

// ============================================================================
// INSTANCE TYPES
// ============================================================================

/**
 * DuckDB database instance
 */
export interface DuckDBInstance {
  /**
   * Database path
   */
  readonly path: string

  /**
   * Whether the database is open
   */
  readonly open: boolean

  /**
   * Execute a SQL query
   *
   * @param sql - SQL query string
   * @param params - Query parameters (optional)
   * @param options - Query options (optional)
   * @returns Query result with rows and column metadata
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    options?: QueryOptions
  ): Promise<QueryResult<T>>

  /**
   * Register an in-memory buffer as a virtual file
   *
   * After registration, the buffer can be queried via:
   * - `SELECT * FROM 'buffer_name'` (auto-detect format)
   * - `SELECT * FROM parquet_scan('buffer_name')` (explicit Parquet)
   * - `SELECT * FROM read_csv('buffer_name')` (explicit CSV)
   *
   * @param name - Virtual file name (should include extension like .parquet)
   * @param buffer - The data buffer to register
   * @param options - Registration options
   * @returns Registration result with final name and size
   *
   * @example
   * ```typescript
   * // Fetch Parquet from R2 and register
   * const response = await env.R2_BUCKET.get('data/sales.parquet')
   * const buffer = await response.arrayBuffer()
   * await db.registerBuffer('sales.parquet', buffer)
   *
   * // Query the registered buffer
   * const result = await db.query("SELECT * FROM 'sales.parquet' LIMIT 10")
   * ```
   */
  registerBuffer(
    name: string,
    buffer: ArrayBuffer | Uint8Array,
    options?: BufferRegistrationOptions
  ): Promise<BufferRegistrationResult>

  /**
   * Unregister a previously registered buffer
   *
   * @param name - The buffer name to unregister
   */
  dropBuffer(name: string): Promise<void>

  /**
   * Close the database connection and release resources
   */
  close(): Promise<void>
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

/**
 * Internal state for WASM module caching
 */
export interface WasmModuleCache {
  /**
   * Compiled WASM module
   */
  module: WebAssembly.Module | null

  /**
   * Module size in bytes
   */
  moduleSize: number

  /**
   * Whether the module has been loaded
   */
  loaded: boolean
}

// ============================================================================
// BUFFER REGISTRATION TYPES
// ============================================================================

/**
 * Options for registering a buffer with DuckDB
 */
export interface BufferRegistrationOptions {
  /**
   * File format hint for the buffer content
   * DuckDB will auto-detect if not specified
   * @default auto-detect from name extension
   */
  format?: 'parquet' | 'csv' | 'json' | 'auto'

  /**
   * Whether to overwrite if a buffer with the same name exists
   * @default true
   */
  overwrite?: boolean
}

/**
 * Result from buffer registration
 */
export interface BufferRegistrationResult {
  /**
   * The registered buffer name (may be normalized)
   */
  name: string

  /**
   * Size of the registered buffer in bytes
   */
  sizeBytes: number

  /**
   * Whether an existing buffer was overwritten
   */
  overwritten: boolean
}
