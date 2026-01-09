/**
 * Configuration options for DuckDB instance initialization
 */
export interface DuckDBConfig {
  /**
   * Maximum memory limit (e.g., '256MB', '1GB')
   */
  maxMemory?: string

  /**
   * Number of threads for parallel query execution
   * Note: In Workers runtime, this is limited to 1
   * @default 1
   */
  threads?: number

  /**
   * Database access mode
   * @default 'automatic'
   */
  accessMode?: 'automatic' | 'read_only' | 'read_write'

  /**
   * Default sort order for queries
   * @default 'asc'
   */
  defaultOrder?: 'asc' | 'desc'

  /**
   * Enable query result caching
   * @default true
   */
  enableCache?: boolean

  /**
   * Custom configuration options passed directly to DuckDB
   */
  customConfig?: Record<string, string | number | boolean>
}

/**
 * Information about a column in a query result
 */
export interface ColumnInfo {
  /**
   * Column name as returned by the query
   */
  name: string

  /**
   * DuckDB type name (e.g., 'INTEGER', 'VARCHAR', 'DOUBLE')
   */
  type: string

  /**
   * DuckDB type code (numeric enum value from C API)
   */
  typeCode: number

  /**
   * Whether the column can contain NULL values
   */
  nullable?: boolean
}

/**
 * Result of a DuckDB query execution
 */
export interface QueryResult<T = Record<string, unknown>> {
  /**
   * Array of result rows
   */
  rows: T[]

  /**
   * Column metadata for the result set
   */
  columns: ColumnInfo[]

  /**
   * Number of rows returned
   */
  rowCount: number

  /**
   * Whether the query executed successfully
   */
  success: boolean

  /**
   * Number of rows affected (for INSERT/UPDATE/DELETE)
   */
  rowsAffected?: number

  /**
   * Execution time in milliseconds
   */
  executionTimeMs?: number
}

/**
 * Main DuckDB instance interface for query execution
 */
export interface DuckDBInstance {
  /**
   * Execute a SQL query and return results
   * @param sql - SQL query string
   * @param params - Optional query parameters for prepared statements
   * @returns Promise resolving to query results
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>

  /**
   * Execute a SQL statement without returning results
   * Useful for DDL statements (CREATE, DROP, etc.)
   * @param sql - SQL statement to execute
   * @param params - Optional query parameters
   */
  exec(sql: string, params?: unknown[]): Promise<void>

  /**
   * Register an in-memory buffer as a named file
   * Allows loading data from ArrayBuffer/Uint8Array
   * @param name - Virtual file name to register
   * @param buffer - Data buffer to register
   */
  registerFileBuffer(name: string, buffer: ArrayBuffer | Uint8Array): void

  /**
   * Remove a previously registered file
   * @param name - Virtual file name to drop
   * @returns true if file was dropped, false if not found
   */
  dropFile(name: string): boolean

  /**
   * Close the DuckDB instance and release resources
   */
  close(): Promise<void>

  /**
   * Check if the instance is still open
   */
  isOpen(): boolean
}

/**
 * Result of WASM instantiation
 */
export interface InstantiationResult {
  /**
   * Whether instantiation was successful
   */
  success: boolean

  /**
   * Error message if instantiation failed
   */
  error?: string

  /**
   * Time taken to instantiate in milliseconds
   */
  instantiationTimeMs?: number
}
