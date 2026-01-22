/**
 * Core type definitions for @dotdo/clickhouse
 * Matches the official ClickHouse client SDK types
 */

/**
 * Query options for ClickHouse queries
 */
export interface QueryOptions {
  /** Output format (default: JSON) */
  format?: 'JSON' | 'JSONEachRow' | 'CSV' | 'TSV' | 'Parquet' | 'Arrow' | 'Native' | string;
  /** Query parameters for parameterized queries */
  params?: Record<string, unknown>;
  /** ClickHouse settings overrides */
  settings?: Record<string, string | number | boolean>;
  /** Abort signal for cancelling queries */
  signal?: AbortSignal;
}

/**
 * Result of a query execution
 */
export interface QueryResult<T = unknown> {
  /** Parsed data rows (when format is JSON-based) */
  data: T[];
  /** Number of rows read during query execution */
  rowsRead: number;
  /** Number of bytes read during query execution */
  bytesRead: number;
  /** Query execution time in seconds */
  elapsed: number;
  /** Raw response data (for non-JSON formats) */
  raw?: ArrayBuffer | string;
}

/**
 * Insert options for batch inserts
 */
export interface InsertOptions {
  /** Format of the data being inserted (default: JSONEachRow) */
  format?: 'JSONEachRow' | 'CSV' | 'TSV' | string;
  /** ClickHouse settings overrides */
  settings?: Record<string, string | number | boolean>;
}

/**
 * Main ClickHouse client interface
 */
export interface ClickHouseClient {
  /**
   * Execute a query and return parsed results
   */
  query<T = unknown>(sql: string, options?: QueryOptions): Promise<QueryResult<T>>;

  /**
   * Execute a query and return raw response
   */
  queryRaw(sql: string, options?: QueryOptions): Promise<string | ArrayBuffer>;

  /**
   * Execute a query and return a stream of batched results
   */
  queryStream<T = unknown>(sql: string, options?: QueryOptions): AsyncIterable<T[]>;

  /**
   * Insert data into a table
   */
  insert<T extends Record<string, unknown>>(
    table: string,
    data: T[],
    options?: InsertOptions
  ): Promise<void>;

  /**
   * Check if the server is reachable
   */
  ping(): Promise<boolean>;

  /**
   * Close the client and clean up resources
   */
  close(): Promise<void>;

  /**
   * The active backend type
   */
  readonly backend?: 'clickhouse' | 'sandbox' | 'wasm' | 'rpc';
}

/**
 * Client configuration options
 */
export interface ClickHouseConfig {
  /** Backend selection */
  backend?: 'auto' | 'clickhouse' | 'sandbox' | 'wasm';

  /** Priority order for backend selection */
  backends?: Array<'clickhouse' | 'sandbox' | 'wasm'>;

  /** ClickHouse server options */
  clickhouse?: {
    host: string;
    username?: string;
    password?: string;
    database?: string;
  };

  /** WASM backend options */
  wasm?: {
    profile?: 'minimal' | 'standard' | 'full';
    memoryLimit?: number;
  };

  /** Sandbox backend options */
  sandbox?: {
    binary?: string;
    timeout?: number;
  };

  /** Common ClickHouse settings */
  settings?: Record<string, string | number | boolean>;
}

/**
 * Base error class for ClickHouse errors
 */
export class ClickHouseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClickHouseError';
  }
}

/**
 * Error thrown when a query fails
 */
export class QueryError extends ClickHouseError {
  /** Position in the query where the error occurred */
  position?: number;
  /** Error code from ClickHouse */
  code?: number;

  constructor(message: string, options?: { position?: number; code?: number }) {
    super(message);
    this.name = 'QueryError';
    this.position = options?.position;
    this.code = options?.code;
  }
}

/**
 * Error thrown when connection fails
 */
export class ConnectionError extends ClickHouseError {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

/**
 * Error thrown for authentication failures
 */
export class AuthenticationError extends ClickHouseError {
  constructor(message: string = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when a timeout occurs
 */
export class TimeoutError extends ClickHouseError {
  constructor(message: string = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when a backend is not available
 */
export class BackendNotAvailableError extends ClickHouseError {
  constructor(backend: string) {
    super(`Backend "${backend}" is not available`);
    this.name = 'BackendNotAvailableError';
  }
}

/**
 * Supported data formats for ClickHouse queries
 */
export type DataFormat =
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
  | 'RowBinary'
  | 'Values'
  | string;

/**
 * Execution statistics from a query
 */
export interface QueryStatistics {
  /** Time taken to execute the query in seconds */
  elapsed: number;
  /** Number of rows read during execution */
  rowsRead: number;
  /** Number of bytes read during execution */
  bytesRead: number;
  /** Number of rows written (for INSERT queries) */
  rowsWritten?: number;
  /** Number of bytes written (for INSERT queries) */
  bytesWritten?: number;
}

/**
 * Progress information during query execution
 */
export interface QueryProgress {
  /** Number of rows read so far */
  readRows: number;
  /** Number of bytes read so far */
  readBytes: number;
  /** Total number of rows to read (if known) */
  totalRowsToRead?: number;
  /** Number of rows written so far */
  writtenRows?: number;
  /** Number of bytes written so far */
  writtenBytes?: number;
}

/**
 * Column metadata from query results
 */
export interface ColumnMeta {
  /** Column name */
  name: string;
  /** ClickHouse data type */
  type: string;
}

/**
 * Extended query result with metadata
 */
export interface QueryResultWithMeta<T = unknown> extends QueryResult<T> {
  /** Column metadata */
  meta?: ColumnMeta[];
  /** Query execution statistics */
  statistics?: QueryStatistics;
  /** Total rows before LIMIT was applied */
  rowsBeforeLimitAtLeast?: number;
}

/**
 * Options for creating tables
 */
export interface CreateTableOptions {
  /** Table engine (e.g., 'MergeTree', 'ReplacingMergeTree') */
  engine: string;
  /** ORDER BY clause */
  orderBy?: string | string[];
  /** PARTITION BY clause */
  partitionBy?: string;
  /** PRIMARY KEY clause */
  primaryKey?: string | string[];
  /** SAMPLE BY clause */
  sampleBy?: string;
  /** TTL expression */
  ttl?: string;
  /** Engine settings */
  settings?: Record<string, string | number | boolean>;
  /** If true, use IF NOT EXISTS */
  ifNotExists?: boolean;
}

/**
 * Schema definition for a table column
 */
export interface ColumnSchema {
  /** Column name */
  name: string;
  /** ClickHouse data type */
  type: string;
  /** Default value expression */
  default?: string;
  /** Materialized expression */
  materialized?: string;
  /** Alias expression */
  alias?: string;
  /** Column codec for compression */
  codec?: string;
  /** Column TTL */
  ttl?: string;
  /** Column comment */
  comment?: string;
}
