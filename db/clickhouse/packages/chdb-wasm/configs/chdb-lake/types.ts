/**
 * chDB Lake Type Definitions
 *
 * Type definitions for the data lake worker that queries Parquet files on R2.
 */

/**
 * Cloudflare Worker environment bindings
 */
export interface LakeEnv {
  /** R2 bucket for data storage (Parquet, CSV, JSON files) */
  DATA_BUCKET: R2Bucket;
  /** R2 bucket for WASM module storage */
  WASM_BUCKET: R2Bucket;
  /** KV namespace for query result caching */
  QUERY_CACHE: KVNamespace;
  /** Version string */
  CHDB_LAKE_VERSION: string;
  /** Environment (production, development) */
  ENVIRONMENT: string;
  /** Maximum query execution time in milliseconds */
  MAX_QUERY_TIME_MS: string;
  /** Maximum result size in bytes */
  MAX_RESULT_SIZE: string;
  /** Enable query result caching */
  ENABLE_CACHE: string;
  /** Cache TTL in seconds */
  CACHE_TTL: string;
}

/**
 * Supported output formats for query results
 */
export type OutputFormat =
  | 'JSON'
  | 'JSONCompact'
  | 'JSONEachRow'
  | 'CSV'
  | 'CSVWithNames'
  | 'TSV'
  | 'TabSeparated'
  | 'Parquet';

/**
 * Supported input file formats
 */
export type InputFormat = 'Parquet' | 'CSV' | 'JSON' | 'JSONEachRow';

/**
 * Query execution options
 */
export interface QueryOptions {
  /** Output format for results */
  format?: OutputFormat;
  /** Maximum number of rows to return */
  maxRows?: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Enable query caching */
  useCache?: boolean;
  /** Cache TTL override in seconds */
  cacheTtl?: number;
}

/**
 * Query execution result
 */
export interface QueryResult {
  /** Column metadata */
  meta: ColumnMeta[];
  /** Result data rows */
  data: unknown[];
  /** Number of rows in result */
  rows: number;
  /** Query execution statistics */
  statistics: QueryStatistics;
}

/**
 * Column metadata
 */
export interface ColumnMeta {
  /** Column name */
  name: string;
  /** ClickHouse data type */
  type: string;
}

/**
 * Query execution statistics
 */
export interface QueryStatistics {
  /** Elapsed time in seconds */
  elapsed: number;
  /** Number of rows read from source files */
  rows_read: number;
  /** Number of bytes read from source files */
  bytes_read: number;
  /** Number of row groups scanned (for Parquet) */
  row_groups_scanned?: number;
  /** Number of row groups skipped via predicate pushdown */
  row_groups_skipped?: number;
  /** Whether result was served from cache */
  from_cache?: boolean;
}

/**
 * Parquet file metadata
 */
export interface ParquetFileMetadata {
  /** Total number of rows in the file */
  numRows: number;
  /** Number of row groups in the file */
  numRowGroups: number;
  /** Row group information */
  rowGroups: ParquetRowGroupMetadata[];
  /** Schema information */
  schema: ParquetSchemaField[];
  /** Creator information */
  createdBy?: string;
  /** Key-value metadata */
  keyValueMetadata?: Record<string, string>;
}

/**
 * Parquet row group metadata
 */
export interface ParquetRowGroupMetadata {
  /** Number of rows in this row group */
  numRows: number;
  /** Total byte size of this row group */
  totalByteSize: number;
  /** Column chunk information */
  columns: ParquetColumnChunkMetadata[];
  /** File offset for this row group */
  fileOffset: number;
  /** Ordinal position of this row group */
  ordinal: number;
}

/**
 * Parquet column chunk metadata
 */
export interface ParquetColumnChunkMetadata {
  /** Column path (dot-separated for nested) */
  columnPath: string;
  /** Physical type */
  type: ParquetPhysicalType;
  /** Encodings used */
  encodings: ParquetEncoding[];
  /** Compressed size in bytes */
  compressedSize: number;
  /** Uncompressed size in bytes */
  uncompressedSize: number;
  /** Offset to data page */
  dataPageOffset: number;
  /** Offset to dictionary page (if present) */
  dictionaryPageOffset?: number;
  /** Column statistics for predicate pushdown */
  statistics?: ParquetColumnStatistics;
  /** Compression codec used */
  compression: ParquetCompression;
}

/**
 * Parquet physical types
 */
export type ParquetPhysicalType =
  | 'BOOLEAN'
  | 'INT32'
  | 'INT64'
  | 'INT96'
  | 'FLOAT'
  | 'DOUBLE'
  | 'BYTE_ARRAY'
  | 'FIXED_LEN_BYTE_ARRAY';

/**
 * Parquet encoding types
 */
export type ParquetEncoding =
  | 'PLAIN'
  | 'PLAIN_DICTIONARY'
  | 'RLE'
  | 'BIT_PACKED'
  | 'DELTA_BINARY_PACKED'
  | 'DELTA_LENGTH_BYTE_ARRAY'
  | 'DELTA_BYTE_ARRAY'
  | 'RLE_DICTIONARY'
  | 'BYTE_STREAM_SPLIT';

/**
 * Parquet compression types
 */
export type ParquetCompression =
  | 'UNCOMPRESSED'
  | 'SNAPPY'
  | 'GZIP'
  | 'LZO'
  | 'BROTLI'
  | 'LZ4'
  | 'ZSTD'
  | 'LZ4_RAW';

/**
 * Parquet column statistics
 */
export interface ParquetColumnStatistics {
  /** Minimum value (if available) */
  min?: unknown;
  /** Maximum value (if available) */
  max?: unknown;
  /** Number of null values */
  nullCount?: number;
  /** Number of distinct values (if available) */
  distinctCount?: number;
  /** Whether min/max values are exact or approximate */
  minMaxAreExact?: boolean;
}

/**
 * Parquet schema field
 */
export interface ParquetSchemaField {
  /** Field name */
  name: string;
  /** Physical type */
  type: ParquetPhysicalType;
  /** Repetition type */
  repetitionType: 'REQUIRED' | 'OPTIONAL' | 'REPEATED';
  /** Logical/converted type */
  convertedType?: ParquetConvertedType;
  /** Type length for fixed-length types */
  typeLength?: number;
  /** Scale for decimal types */
  scale?: number;
  /** Precision for decimal types */
  precision?: number;
  /** Nested fields for groups */
  fields?: ParquetSchemaField[];
}

/**
 * Parquet converted/logical types
 */
export type ParquetConvertedType =
  | 'UTF8'
  | 'MAP'
  | 'MAP_KEY_VALUE'
  | 'LIST'
  | 'ENUM'
  | 'DECIMAL'
  | 'DATE'
  | 'TIME_MILLIS'
  | 'TIME_MICROS'
  | 'TIMESTAMP_MILLIS'
  | 'TIMESTAMP_MICROS'
  | 'UINT_8'
  | 'UINT_16'
  | 'UINT_32'
  | 'UINT_64'
  | 'INT_8'
  | 'INT_16'
  | 'INT_32'
  | 'INT_64'
  | 'JSON'
  | 'BSON'
  | 'INTERVAL';

/**
 * R2 object reference parsed from s3() function
 */
export interface R2ObjectReference {
  /** Target bucket */
  bucket: 'data' | 'wasm';
  /** Object path (may contain glob patterns) */
  path: string;
  /** File format */
  format: InputFormat;
  /** Whether path contains glob patterns */
  isGlob: boolean;
}

/**
 * Predicate for row group filtering
 */
export interface FilterPredicate {
  /** Column name */
  column: string;
  /** Comparison operator */
  operator: '=' | '!=' | '<' | '>' | '<=' | '>=' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL';
  /** Comparison value(s) */
  value: unknown;
}

/**
 * Query plan information
 */
export interface QueryPlan {
  /** Files to be scanned */
  files: string[];
  /** Columns to project */
  projectedColumns: string[] | null;
  /** Filter predicates for pushdown */
  predicates: FilterPredicate[];
  /** Estimated rows to scan */
  estimatedRows: number;
  /** Estimated bytes to read */
  estimatedBytes: number;
}

/**
 * Lake WASM module interface
 */
export interface LakeWasmModule {
  /** Initialize the module */
  initialize(): Promise<void>;

  /** Execute a SQL query and return formatted results */
  executeQuery(sql: string, format: OutputFormat): Promise<string>;

  /** Register a file for querying */
  registerFile(name: string, data: ArrayBuffer): void;

  /** Unregister a file */
  unregisterFile(name: string): void;

  /** Set row group filter predicate */
  setRowGroupFilter(predicate: (metadata: ParquetRowGroupMetadata) => boolean): void;

  /** Set column projection for Parquet reads */
  setColumnProjection(columns: string[]): void;

  /** Clear column projection (read all columns) */
  clearColumnProjection(): void;

  /** Get module version */
  getVersion(): string;

  /** Get memory usage statistics */
  getMemoryStats(): { used: number; peak: number; limit: number };

  /** Clear internal caches */
  clearCache(): void;
}

/**
 * Cache entry metadata
 */
export interface CacheEntry {
  /** Query hash */
  queryHash: string;
  /** Result size in bytes */
  size: number;
  /** Creation timestamp */
  created: number;
  /** Expiration timestamp */
  expires: number;
  /** Number of hits */
  hits: number;
}

/**
 * Error types
 */
export class LakeQueryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly query?: string
  ) {
    super(message);
    this.name = 'LakeQueryError';
  }
}

export class FileNotFoundError extends LakeQueryError {
  constructor(path: string) {
    super(`File not found: ${path}`, 'FILE_NOT_FOUND', undefined);
    this.name = 'FileNotFoundError';
  }
}

export class InvalidParquetError extends LakeQueryError {
  constructor(path: string, reason: string) {
    super(`Invalid Parquet file ${path}: ${reason}`, 'INVALID_PARQUET', undefined);
    this.name = 'InvalidParquetError';
  }
}

export class QueryTimeoutError extends LakeQueryError {
  constructor(timeoutMs: number) {
    super(`Query exceeded timeout of ${timeoutMs}ms`, 'QUERY_TIMEOUT', undefined);
    this.name = 'QueryTimeoutError';
  }
}

export class ResultTooLargeError extends LakeQueryError {
  constructor(size: number, limit: number) {
    super(`Result size ${size} exceeds limit ${limit}`, 'RESULT_TOO_LARGE', undefined);
    this.name = 'ResultTooLargeError';
  }
}
