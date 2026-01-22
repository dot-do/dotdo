/**
 * Core type definitions for @dotdo/chdb
 * Matches the official chdb SDK types
 */

/**
 * Supported output formats for query results
 */
export type OutputFormat =
  | 'JSON'
  | 'JSONEachRow'
  | 'JSONCompact'
  | 'JSONColumns'
  | 'CSV'
  | 'CSVWithNames'
  | 'TSV'
  | 'TSVWithNames'
  | 'Parquet'
  | 'Arrow'
  | 'ArrowStream'
  | 'Native'
  | 'RowBinary'
  | 'Pretty'
  | 'PrettyCompact'
  | string;

/**
 * Arrow-specific format options
 */
export interface ArrowFormatOptions {
  /** Use Arrow IPC streaming format (default: true) */
  useStreaming?: boolean;
  /** Compression codec for Arrow data */
  compression?: 'none' | 'lz4' | 'zstd';
}

/**
 * Query options for chdb queries
 */
export interface QueryOptions {
  /** Output format (default: JSON) */
  format?: OutputFormat;
  /** Query parameters for parameterized queries */
  params?: Record<string, unknown>;
  /** ClickHouse settings overrides */
  settings?: Record<string, string | number | boolean>;
  /** Arrow-specific format options (only used when format is 'Arrow' or 'ArrowStream') */
  arrowOptions?: ArrowFormatOptions;
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
 * Session for executing multiple queries with shared state
 */
export interface Session {
  /** Session identifier */
  readonly id: string;

  /**
   * Execute a query within this session
   */
  query<T = unknown>(sql: string, options?: QueryOptions): Promise<QueryResult<T>>;

  /**
   * Execute a query and return a stream of results
   */
  queryStream<T = unknown>(sql: string, options?: QueryOptions): AsyncIterable<T[]>;

  /**
   * Close the session and clean up resources
   */
  close(): Promise<void>;
}

/**
 * Main chdb client interface
 */
export interface ChdbClient {
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
   * Create a new session for executing multiple queries with shared state
   */
  createSession(): Promise<Session>;

  /**
   * Close the client and clean up resources
   */
  close(): Promise<void>;
}

/**
 * Client configuration options
 */
export interface ChdbConfig {
  /** Backend selection */
  backend?: 'auto' | 'wasm' | 'sandbox';

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
 * Base error class for chdb errors
 */
export class ChdbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChdbError';
  }
}

/**
 * Error thrown when a query fails
 */
export class QueryError extends ChdbError {
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
export class ConnectionError extends ChdbError {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

/**
 * Error thrown for authentication failures
 */
export class AuthenticationError extends ChdbError {
  constructor(message: string = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}
