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

  /**
   * How to handle BIGINT values in query results for JSON serialization.
   *
   * - 'auto' (default): Convert to number if within safe integer range
   *   (Number.MIN_SAFE_INTEGER to Number.MAX_SAFE_INTEGER), otherwise to string.
   * - 'string': Always convert to string to preserve full precision.
   * - 'number': Always convert to number (may lose precision for large values).
   *
   * @default 'auto'
   */
  bigIntMode?: 'auto' | 'string' | 'number'
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
 * Prepared statement interface for reusable parameterized queries
 *
 * Prepared statements provide:
 * 1. SQL injection safety - parameters are properly escaped
 * 2. Performance - statement can be reused with different parameters
 * 3. Type safety - results are typed
 *
 * @example
 * ```typescript
 * const stmt = await db.prepare<{ name: string }>('SELECT name FROM users WHERE id = $1')
 * try {
 *   const result1 = await stmt.execute([1])
 *   const result2 = await stmt.execute([2])
 * } finally {
 *   await stmt.finalize()
 * }
 * ```
 */
export interface PreparedStatementInterface<T = Record<string, unknown>> {
  /**
   * Bind parameters to the prepared statement
   * Parameters are bound by position ($1, $2, etc.)
   *
   * @param params Array of parameter values
   */
  bind(params: unknown[]): void

  /**
   * Execute the prepared statement
   *
   * @param params Optional parameters to bind before execution
   * @returns Query result with typed rows
   */
  execute(params?: unknown[]): Promise<QueryResult<T>>

  /**
   * Finalize (destroy) the prepared statement
   * Releases resources. The statement cannot be used after this.
   */
  finalize(): Promise<void>

  /**
   * Check if the statement has been finalized
   */
  isFinalized(): boolean
}

/**
 * Main DuckDB instance interface for query execution
 */
export interface DuckDBInstance {
  /**
   * Execute a SQL query and return results
   *
   * When params are provided, the query is executed as a prepared statement
   * for SQL injection safety.
   *
   * @param sql - SQL query string with $1, $2, ... placeholders for params
   * @param params - Optional query parameters for prepared statements
   * @returns Promise resolving to query results
   *
   * @example
   * ```typescript
   * // Without parameters (direct execution)
   * const result = await db.query('SELECT * FROM users')
   *
   * // With parameters (prepared statement - SQL injection safe)
   * const result = await db.query(
   *   'SELECT * FROM users WHERE id = $1 AND active = $2',
   *   [userId, true]
   * )
   * ```
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>

  /**
   * Execute a SQL statement without returning results
   *
   * Useful for DDL statements (CREATE, DROP, etc.) and DML
   * statements where you don't need the result rows.
   *
   * When params are provided, the statement is executed as a prepared
   * statement for SQL injection safety.
   *
   * @param sql - SQL statement to execute
   * @param params - Optional query parameters
   *
   * @example
   * ```typescript
   * // Without parameters
   * await db.exec('CREATE TABLE users (id INTEGER, name VARCHAR)')
   *
   * // With parameters (SQL injection safe)
   * await db.exec(
   *   'INSERT INTO users VALUES ($1, $2)',
   *   [1, 'Alice']
   * )
   * ```
   */
  exec(sql: string, params?: unknown[]): Promise<void>

  /**
   * Create a prepared statement for reuse
   *
   * Prepared statements are useful when you need to execute the same
   * query multiple times with different parameters. They provide:
   * - SQL injection safety
   * - Better performance for repeated queries
   * - Explicit lifecycle management
   *
   * Always call finalize() when done to release resources.
   *
   * @param sql - SQL query string with $1, $2, ... placeholders
   * @returns Prepared statement interface
   *
   * @example
   * ```typescript
   * const stmt = await db.prepare<{ name: string }>(
   *   'SELECT name FROM users WHERE id = $1'
   * )
   * try {
   *   for (const id of userIds) {
   *     const result = await stmt.execute([id])
   *     console.log(result.rows[0]?.name)
   *   }
   * } finally {
   *   await stmt.finalize()
   * }
   * ```
   */
  prepare<T = Record<string, unknown>>(
    sql: string
  ): Promise<PreparedStatementInterface<T>>

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
   * Retrieve a registered file buffer
   * @param name - Virtual file name
   * @returns The buffer if found, undefined otherwise
   */
  getFileBuffer(name: string): Uint8Array | undefined

  /**
   * Check if a virtual file exists in this instance
   * @param name - Virtual file name
   * @returns true if file is registered
   */
  hasFile(name: string): boolean

  /**
   * List all registered virtual files for this instance
   * @returns Array of registered file names
   */
  listFiles(): string[]

  /**
   * Close the DuckDB instance and release resources
   */
  close(): Promise<void>

  /**
   * Check if the instance is still open
   */
  isOpen(): boolean

  /**
   * Warnings from config application.
   * If config settings failed to apply, the error messages are stored here.
   * Check this array after creating an instance with config options.
   */
  configWarnings: string[]
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
