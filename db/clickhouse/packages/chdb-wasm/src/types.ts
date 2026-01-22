// =============================================================================
// Shared Type Definitions for Type Safety
// =============================================================================

/**
 * Properly typed row data - uses unknown instead of any
 */
export type RowData = Record<string, unknown>;

/**
 * Properly typed column metadata
 */
export interface ColumnMeta {
  name: string;
  type: string;
}

/**
 * Query execution statistics
 */
export interface QueryStatistics {
  elapsed?: number;
  rows_read?: number;
  bytes_read?: number;
  written_rows?: number;
}

/**
 * Properly typed query result structure
 */
export interface QueryResult {
  meta: ColumnMeta[];
  data: RowData[];
  rows: number;
  statistics?: QueryStatistics;
}

/**
 * Parsed value type - can be string, number, boolean, null, or nested array/object
 * Using interface for recursive object type to avoid circular reference error
 */
export interface ParsedValueObject {
  [key: string]: ParsedValue;
}
export type ParsedValue = string | number | boolean | null | ParsedValue[] | ParsedValueObject;

/**
 * SQL parameter value type - used for parameterized queries
 */
export type SqlParamValue = string | number | boolean | null | SqlParamValue[];

/**
 * DO_STORAGE interface for Durable Object storage
 */
export interface DoStorage {
  lookupFile(path: string): unknown;
}

/**
 * PGlite instance type (opaque reference for connection pooling)
 */
export type PgliteInstanceRef = unknown;

/**
 * Durable Object storage instance map type
 */
export type DoStorageInstances = Map<string, unknown>;

// =============================================================================
// Original Types (ChdbConfig, etc.)
// =============================================================================

/**
 * Configuration options for creating a chdb instance.
 */
export interface ChdbConfig {
  /**
   * Memory limit in bytes for the WASM module.
   * @default 67108864 (64MB)
   */
  memoryLimit?: number;

  /**
   * Enable query logging for debugging.
   * @default false
   */
  logging?: boolean;

  /**
   * Custom ClickHouse settings to apply.
   */
  settings?: Record<string, string | number>;

  /**
   * Build profile to use.
   * @default 'standard'
   */
  profile?: 'minimal' | 'standard' | 'full';

  /**
   * Custom path to the WASM binary.
   * Useful for hosting WASM files on custom locations.
   */
  wasmPath?: string;

  /**
   * Cloudflare Workers Static Assets binding.
   * When provided, WASM files are loaded from Static Assets.
   * This is the recommended approach for Cloudflare Workers deployments.
   *
   * @example
   * ```typescript
   * // In wrangler.toml:
   * // [assets]
   * // directory = "./dist"
   * // binding = "ASSETS"
   *
   * const chdb = await createChdb({ assets: env.ASSETS });
   * ```
   */
  assets?: Fetcher;
}

/**
 * Supported output formats for query results.
 */
export type OutputFormat =
  | 'JSON'
  | 'JSONEachRow'
  | 'JSONCompact'
  | 'JSONStringsEachRow'
  | 'CSV'
  | 'CSVWithNames'
  | 'TSV'
  | 'TSVWithNames'
  | 'Parquet'
  | 'Arrow'
  | 'Native'
  | 'Pretty'
  | 'PrettyCompact';

/**
 * Options for executing a query.
 */
export interface QueryOptions {
  /**
   * Output format for the query results.
   * @default 'JSON'
   */
  format?: OutputFormat;

  /**
   * Query parameters for parameterized queries.
   */
  params?: Record<string, string | number | boolean | null>;

  /**
   * Timeout in milliseconds for the query execution.
   */
  timeout?: number;
}

/**
 * Memory usage statistics for the WASM module.
 */
export interface MemoryStats {
  /**
   * Currently used memory in bytes.
   */
  used: number;

  /**
   * Peak memory usage in bytes since instance creation.
   */
  peak: number;

  /**
   * Configured memory limit in bytes.
   */
  limit: number;
}

/**
 * A chdb instance for executing ClickHouse queries via WASM.
 */
export interface ChdbInstance {
  /**
   * Execute a query and return the complete result.
   * @param sql - The SQL query to execute.
   * @param options - Optional query configuration.
   * @returns The query result as a string in the specified format.
   */
  query(sql: string, options?: QueryOptions): Promise<string>;

  /**
   * Execute a query and stream the results.
   * Useful for large result sets to avoid memory issues.
   * @param sql - The SQL query to execute.
   * @param options - Optional query configuration.
   * @returns An async iterable of result chunks.
   */
  queryStream(sql: string, options?: QueryOptions): AsyncIterable<string>;

  /**
   * Get current memory usage statistics.
   * @returns Memory statistics for the WASM module.
   */
  getMemoryStats(): MemoryStats;

  /**
   * Clear internal caches to free memory.
   * Useful for long-running instances in Durable Objects.
   */
  clearCache(): void;

  /**
   * Dispose the instance and free all resources.
   * The instance should not be used after calling this method.
   */
  dispose(): void;

  /**
   * Check if the instance has been disposed.
   */
  readonly disposed: boolean;
}

/**
 * Internal WASM module exports interface.
 * @internal
 */
export interface WasmModuleExports {
  memory: WebAssembly.Memory;
  malloc: (size: number) => number;
  free: (ptr: number) => void;
  chdb_query: (sqlPtr: number, sqlLen: number, formatPtr: number, formatLen: number) => number;
  chdb_query_stream_start: (sqlPtr: number, sqlLen: number, formatPtr: number, formatLen: number) => number;
  chdb_query_stream_next: (streamHandle: number) => number;
  chdb_query_stream_end: (streamHandle: number) => void;
  chdb_get_result_ptr: (resultHandle: number) => number;
  chdb_get_result_len: (resultHandle: number) => number;
  chdb_free_result: (resultHandle: number) => void;
  chdb_get_memory_used: () => number;
  chdb_get_memory_peak: () => number;
  chdb_clear_cache: () => void;
  chdb_set_setting: (keyPtr: number, keyLen: number, valuePtr: number, valueLen: number) => number;
  chdb_init: (memoryLimit: number) => number;
  chdb_destroy: () => void;
}

/**
 * Internal loaded WASM module interface.
 * @internal
 */
export interface LoadedWasmModule {
  instance: WebAssembly.Instance;
  exports: WasmModuleExports;
  encoder: TextEncoder;
  decoder: TextDecoder;
}

/**
 * Error thrown when a query fails.
 */
export class ChdbError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly query?: string
  ) {
    super(message);
    this.name = 'ChdbError';
  }
}

/**
 * Error thrown when the instance has been disposed.
 */
export class DisposedError extends Error {
  constructor() {
    super('ChdbInstance has been disposed');
    this.name = 'DisposedError';
  }
}
