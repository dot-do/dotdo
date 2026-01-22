/**
 * Parquet Reader for Remote URLs
 *
 * Reads Parquet files from remote URLs using HTTP range requests for efficient
 * streaming. Uses hyparquet (pure JavaScript) for Parquet parsing.
 *
 * Key features:
 * - HTTP Range requests for streaming large files
 * - Column projection (only read needed columns)
 * - Row group statistics for predicate pushdown
 * - Compatible with ClickBench executor data format
 *
 * @module parquet-reader
 */

import { parquetRead, parquetMetadataAsync, parquetSchema, type SchemaElement, type FileMetaData } from 'hyparquet';
import * as snappyjs from 'snappyjs';
import { gunzipSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';

// ============================================================================
// Types
// ============================================================================

/**
 * Column metadata from Parquet schema
 */
export interface ParquetColumnInfo {
  name: string;
  type: string; // ClickHouse-compatible type
  nullable: boolean;
  physicalType?: string;
  logicalType?: string;
}

/**
 * Parquet file metadata
 */
export interface ParquetFileMetadata {
  schema: ParquetColumnInfo[];
  rowCount: number;
  rowGroups: number;
  createdBy?: string;
  fileSize?: number;
}

/**
 * Options for reading Parquet data
 */
export interface ParquetReadOptions {
  /** Columns to read (null = all columns) */
  columns?: string[] | null;
  /** Maximum rows to return */
  limit?: number;
  /** Rows to skip */
  offset?: number;
  /** Row groups to read (null = all) */
  rowGroups?: number[] | null;
}

/**
 * Result of reading Parquet data
 */
export interface ParquetReadResult {
  /** Row data as objects */
  data: Record<string, unknown>[];
  /** Column metadata */
  meta: Array<{ name: string; type: string }>;
  /** Number of rows returned */
  rows: number;
  /** Total rows in file before limit */
  totalRows: number;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
}

/**
 * Row group statistics for predicate pushdown
 */
export interface RowGroupStatistics {
  rowGroupIndex: number;
  numRows: number;
  totalByteSize: number;
  columns: Map<string, {
    min?: unknown;
    max?: unknown;
    nullCount?: number;
  }>;
}

// ============================================================================
// Compression Codecs
// ============================================================================

/**
 * Pure JS compressors for Cloudflare Workers compatibility
 * WASM-based compressors don't work reliably in Workers
 */
const compressors = {
  SNAPPY: (input: Uint8Array) => snappyjs.uncompress(input),
  GZIP: (input: Uint8Array) => gunzipSync(input),
  ZSTD: (input: Uint8Array) => zstdDecompress(input),
  UNCOMPRESSED: (input: Uint8Array) => input,
  // LZ4 and Brotli not yet supported in pure JS
  LZ4: undefined,
  LZ4_RAW: undefined,
  BROTLI: undefined,
};

// ============================================================================
// Type Mapping
// ============================================================================

/**
 * Map Parquet physical/logical types to ClickHouse types
 */
function parquetTypeToClickHouse(element: SchemaElement): string {
  const physicalType = element.type;
  const logicalType = element.logical_type;
  const convertedType = element.converted_type;

  // Handle logical types first (more specific)
  if (logicalType && typeof logicalType === 'object' && 'type' in logicalType) {
    const lt = logicalType as { type: string; bitWidth?: number; isSigned?: boolean; precision?: number; scale?: number };
    switch (lt.type) {
      case 'STRING':
      case 'ENUM':
      case 'JSON':
      case 'BSON':
        return 'String';
      case 'INTEGER': {
        const bits = lt.bitWidth || 32;
        const signed = lt.isSigned !== false;
        if (bits <= 8) return signed ? 'Int8' : 'UInt8';
        if (bits <= 16) return signed ? 'Int16' : 'UInt16';
        if (bits <= 32) return signed ? 'Int32' : 'UInt32';
        return signed ? 'Int64' : 'UInt64';
      }
      case 'DATE':
        return 'Date';
      case 'TIMESTAMP':
      case 'TIME':
        return 'DateTime';
      case 'DECIMAL':
        return `Decimal(${lt.precision || 18}, ${lt.scale || 2})`;
      case 'UUID':
        return 'UUID';
    }
  }

  // Handle converted types (older Parquet format)
  if (convertedType) {
    switch (convertedType) {
      case 'UTF8':
      case 'ENUM':
      case 'JSON':
      case 'BSON':
        return 'String';
      case 'DATE':
        return 'Date';
      case 'TIME_MILLIS':
      case 'TIME_MICROS':
      case 'TIMESTAMP_MILLIS':
      case 'TIMESTAMP_MICROS':
        return 'DateTime';
      case 'UINT_8': return 'UInt8';
      case 'UINT_16': return 'UInt16';
      case 'UINT_32': return 'UInt32';
      case 'UINT_64': return 'UInt64';
      case 'INT_8': return 'Int8';
      case 'INT_16': return 'Int16';
      case 'INT_32': return 'Int32';
      case 'INT_64': return 'Int64';
      case 'DECIMAL': return 'Decimal(18, 2)';
      case 'MAP':
      case 'LIST':
        return 'String'; // Serialize as JSON
    }
  }

  // Fall back to physical types
  switch (physicalType) {
    case 'BOOLEAN': return 'UInt8';
    case 'INT32': return 'Int32';
    case 'INT64': return 'Int64';
    case 'INT96': return 'DateTime';
    case 'FLOAT': return 'Float32';
    case 'DOUBLE': return 'Float64';
    case 'BYTE_ARRAY':
    case 'FIXED_LEN_BYTE_ARRAY':
      return 'String';
    default:
      return 'String';
  }
}

/**
 * Convert hyparquet value to JavaScript value based on ClickHouse type
 */
function convertValue(value: unknown, clickhouseType: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  // Handle BigInt
  if (typeof value === 'bigint') {
    if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
      return Number(value);
    }
    return value.toString();
  }

  // Handle Date types
  if (clickhouseType === 'Date') {
    if (value instanceof Date) {
      return value.toISOString().split('T')[0];
    }
    if (typeof value === 'number') {
      // Days since epoch
      const date = new Date(value * 86400000);
      return date.toISOString().split('T')[0];
    }
  }

  // Handle DateTime types
  if (clickhouseType === 'DateTime') {
    if (value instanceof Date) {
      return value.toISOString().replace('T', ' ').substring(0, 19);
    }
    if (typeof value === 'number') {
      const date = new Date(value);
      return date.toISOString().replace('T', ' ').substring(0, 19);
    }
  }

  // Handle Boolean (stored as UInt8 in ClickHouse)
  if (clickhouseType === 'UInt8' && typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  // Handle Uint8Array/ArrayBuffer (binary data)
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    try {
      return new TextDecoder().decode(bytes);
    } catch {
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }

  return value;
}

// ============================================================================
// AsyncBuffer for HTTP Range Requests
// ============================================================================

/**
 * Create an AsyncBuffer that fetches data from a URL using HTTP range requests
 */
function createHttpAsyncBuffer(url: string, fileSize: number, fetchFn: typeof fetch = fetch): {
  byteLength: number;
  slice: (start: number, end?: number) => Promise<ArrayBuffer>;
} {
  return {
    byteLength: fileSize,
    async slice(start: number, end?: number): Promise<ArrayBuffer> {
      const rangeEnd = end ? end - 1 : '';
      const response = await fetchFn(url, {
        headers: {
          Range: `bytes=${start}-${rangeEnd}`,
        },
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.arrayBuffer();
    },
  };
}

/**
 * Create an AsyncBuffer from ArrayBuffer (for in-memory data)
 */
function createMemoryAsyncBuffer(data: ArrayBuffer): {
  byteLength: number;
  slice: (start: number, end?: number) => Promise<ArrayBuffer>;
} {
  return {
    byteLength: data.byteLength,
    async slice(start: number, end?: number): Promise<ArrayBuffer> {
      return data.slice(start, end);
    },
  };
}

// ============================================================================
// ParquetReader Class
// ============================================================================

/**
 * Parquet reader for remote URLs with HTTP range request support
 *
 * @example
 * ```typescript
 * const reader = new ParquetReader('https://datasets.clickhouse.com/hits_compatible/hits.parquet');
 * const data = await reader.readColumns(['CounterID', 'UserID'], { limit: 1000 });
 * ```
 */
export class ParquetReader {
  private url: string;
  private fileSize: number | null = null;
  private metadata: FileMetaData | null = null;
  private schemaInfo: ParquetColumnInfo[] | null = null;
  private columnTypes: Map<string, string> = new Map();
  private fetchFn: typeof fetch;

  /**
   * Create a new ParquetReader
   *
   * @param url URL to the Parquet file
   * @param fetchFn Optional custom fetch function (for testing or custom auth)
   */
  constructor(url: string, fetchFn: typeof fetch = fetch) {
    this.url = url;
    this.fetchFn = fetchFn;
  }

  /**
   * Get the file size using a HEAD request
   */
  private async getFileSize(): Promise<number> {
    if (this.fileSize !== null) {
      return this.fileSize;
    }

    const response = await this.fetchFn(this.url, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(`Failed to get file size: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      throw new Error('Server did not return Content-Length header');
    }

    this.fileSize = parseInt(contentLength, 10);
    return this.fileSize;
  }

  /**
   * Check if the server supports range requests
   */
  async supportsRangeRequests(): Promise<boolean> {
    const response = await this.fetchFn(this.url, { method: 'HEAD' });
    const acceptRanges = response.headers.get('accept-ranges');
    return acceptRanges === 'bytes';
  }

  /**
   * Get file metadata (schema, row count, etc.)
   */
  async getMetadata(): Promise<ParquetFileMetadata> {
    if (this.metadata && this.schemaInfo) {
      return {
        schema: this.schemaInfo,
        rowCount: Number(this.metadata.num_rows),
        rowGroups: this.metadata.row_groups?.length || 1,
        createdBy: this.metadata.created_by,
        fileSize: this.fileSize ?? undefined,
      };
    }

    const fileSize = await this.getFileSize();
    const asyncBuffer = createHttpAsyncBuffer(this.url, fileSize, this.fetchFn);

    this.metadata = await parquetMetadataAsync(asyncBuffer);
    const schemaTree = parquetSchema(this.metadata);

    this.schemaInfo = [];
    this.columnTypes.clear();

    if (schemaTree.children) {
      for (const child of schemaTree.children) {
        const colName = child.element.name;
        const colType = parquetTypeToClickHouse(child.element);
        const nullable = child.element.repetition_type !== 'REQUIRED';

        this.schemaInfo.push({
          name: colName,
          type: colType,
          nullable,
          physicalType: child.element.type,
          logicalType: child.element.logical_type ? JSON.stringify(child.element.logical_type) : undefined,
        });
        this.columnTypes.set(colName, colType);
      }
    }

    return {
      schema: this.schemaInfo,
      rowCount: Number(this.metadata.num_rows),
      rowGroups: this.metadata.row_groups?.length || 1,
      createdBy: this.metadata.created_by,
      fileSize,
    };
  }

  /**
   * Get all column names in the file
   */
  async getColumnNames(): Promise<string[]> {
    const metadata = await this.getMetadata();
    return metadata.schema.map(col => col.name);
  }

  /**
   * Read specific columns from the Parquet file
   *
   * @param columns Column names to read (null = all columns)
   * @param options Read options (limit, offset, rowGroups)
   * @returns Data rows and metadata
   */
  async readColumns(
    columns: string[] | null,
    options: Omit<ParquetReadOptions, 'columns'> = {}
  ): Promise<ParquetReadResult> {
    const startTime = performance.now();

    // Ensure metadata is loaded
    const metadata = await this.getMetadata();

    // Validate requested columns
    if (columns) {
      const allColumnNames = metadata.schema.map(c => c.name);
      for (const col of columns) {
        if (!allColumnNames.includes(col)) {
          throw new Error(`Column "${col}" not found in Parquet file. Available columns: ${allColumnNames.join(', ')}`);
        }
      }
    }

    // Get file size and create async buffer
    const fileSize = await this.getFileSize();
    const asyncBuffer = createHttpAsyncBuffer(this.url, fileSize, this.fetchFn);

    // Calculate row range
    const totalRows = Number(this.metadata!.num_rows);
    const rowStart = options.offset || 0;
    const rowEnd = options.limit ? Math.min(rowStart + options.limit, totalRows) : totalRows;

    // Columns to read
    const columnsToRead = columns || metadata.schema.map(c => c.name);

    // Build meta for result
    const meta = columnsToRead.map(name => ({
      name,
      type: this.columnTypes.get(name) || 'String',
    }));

    // Read data
    const rows: Record<string, unknown>[] = [];

    await parquetRead({
      file: asyncBuffer,
      columns: columnsToRead,
      rowStart,
      rowEnd,
      compressors,
      rowFormat: 'object',
      onComplete: (data: Record<string, unknown>[]) => {
        for (const row of data) {
          const convertedRow: Record<string, unknown> = {};
          for (const key of Object.keys(row)) {
            const clickhouseType = this.columnTypes.get(key) || 'String';
            convertedRow[key] = convertValue(row[key], clickhouseType);
          }
          rows.push(convertedRow);
        }
      },
    });

    const elapsedMs = performance.now() - startTime;

    return {
      data: rows,
      meta,
      rows: rows.length,
      totalRows,
      elapsedMs,
    };
  }

  /**
   * Read all data from the Parquet file
   *
   * @param options Read options (limit, offset)
   * @returns Data rows and metadata
   */
  async readAll(options: Omit<ParquetReadOptions, 'columns'> = {}): Promise<ParquetReadResult> {
    return this.readColumns(null, options);
  }

  /**
   * Get row group statistics for predicate pushdown
   */
  async getRowGroupStats(): Promise<RowGroupStatistics[]> {
    // Ensure metadata is loaded
    await this.getMetadata();

    if (!this.metadata?.row_groups) {
      return [];
    }

    const stats: RowGroupStatistics[] = [];

    for (let i = 0; i < this.metadata.row_groups.length; i++) {
      const rg = this.metadata.row_groups[i];
      const columnStats = new Map<string, { min?: unknown; max?: unknown; nullCount?: number }>();

      if (rg.columns) {
        for (const col of rg.columns) {
          const colMeta = col.meta_data;
          if (colMeta && colMeta.statistics) {
            const colName = colMeta.path_in_schema?.join('.') || '';
            columnStats.set(colName, {
              min: colMeta.statistics.min_value,
              max: colMeta.statistics.max_value,
              nullCount: colMeta.statistics.null_count ? Number(colMeta.statistics.null_count) : undefined,
            });
          }
        }
      }

      stats.push({
        rowGroupIndex: i,
        numRows: Number(rg.num_rows),
        totalByteSize: Number(rg.total_byte_size),
        columns: columnStats,
      });
    }

    return stats;
  }

  /**
   * Create a ParquetReader from an in-memory ArrayBuffer
   *
   * @param data ArrayBuffer containing Parquet data
   * @returns ParquetReader that reads from memory
   */
  static fromBuffer(data: ArrayBuffer): ParquetReaderFromBuffer {
    return new ParquetReaderFromBuffer(data);
  }
}

/**
 * Parquet reader for in-memory ArrayBuffer data
 */
export class ParquetReaderFromBuffer {
  private data: ArrayBuffer;
  private metadata: FileMetaData | null = null;
  private schemaInfo: ParquetColumnInfo[] | null = null;
  private columnTypes: Map<string, string> = new Map();

  constructor(data: ArrayBuffer) {
    this.data = data;
  }

  /**
   * Get file metadata
   */
  async getMetadata(): Promise<ParquetFileMetadata> {
    if (this.metadata && this.schemaInfo) {
      return {
        schema: this.schemaInfo,
        rowCount: Number(this.metadata.num_rows),
        rowGroups: this.metadata.row_groups?.length || 1,
        createdBy: this.metadata.created_by,
        fileSize: this.data.byteLength,
      };
    }

    const asyncBuffer = createMemoryAsyncBuffer(this.data);
    this.metadata = await parquetMetadataAsync(asyncBuffer);
    const schemaTree = parquetSchema(this.metadata);

    this.schemaInfo = [];
    this.columnTypes.clear();

    if (schemaTree.children) {
      for (const child of schemaTree.children) {
        const colName = child.element.name;
        const colType = parquetTypeToClickHouse(child.element);
        const nullable = child.element.repetition_type !== 'REQUIRED';

        this.schemaInfo.push({
          name: colName,
          type: colType,
          nullable,
          physicalType: child.element.type,
        });
        this.columnTypes.set(colName, colType);
      }
    }

    return {
      schema: this.schemaInfo,
      rowCount: Number(this.metadata.num_rows),
      rowGroups: this.metadata.row_groups?.length || 1,
      createdBy: this.metadata.created_by,
      fileSize: this.data.byteLength,
    };
  }

  /**
   * Read specific columns from the Parquet data
   */
  async readColumns(
    columns: string[] | null,
    options: Omit<ParquetReadOptions, 'columns'> = {}
  ): Promise<ParquetReadResult> {
    const startTime = performance.now();

    const metadata = await this.getMetadata();
    const asyncBuffer = createMemoryAsyncBuffer(this.data);

    // Validate columns
    if (columns) {
      const allColumnNames = metadata.schema.map(c => c.name);
      for (const col of columns) {
        if (!allColumnNames.includes(col)) {
          throw new Error(`Column "${col}" not found in Parquet file`);
        }
      }
    }

    const totalRows = Number(this.metadata!.num_rows);
    const rowStart = options.offset || 0;
    const rowEnd = options.limit ? Math.min(rowStart + options.limit, totalRows) : totalRows;

    const columnsToRead = columns || metadata.schema.map(c => c.name);
    const meta = columnsToRead.map(name => ({
      name,
      type: this.columnTypes.get(name) || 'String',
    }));

    const rows: Record<string, unknown>[] = [];

    await parquetRead({
      file: asyncBuffer,
      columns: columnsToRead,
      rowStart,
      rowEnd,
      compressors,
      rowFormat: 'object',
      onComplete: (data: Record<string, unknown>[]) => {
        for (const row of data) {
          const convertedRow: Record<string, unknown> = {};
          for (const key of Object.keys(row)) {
            const clickhouseType = this.columnTypes.get(key) || 'String';
            convertedRow[key] = convertValue(row[key], clickhouseType);
          }
          rows.push(convertedRow);
        }
      },
    });

    const elapsedMs = performance.now() - startTime;

    return {
      data: rows,
      meta,
      rows: rows.length,
      totalRows,
      elapsedMs,
    };
  }

  /**
   * Read all data from the Parquet buffer
   */
  async readAll(options: Omit<ParquetReadOptions, 'columns'> = {}): Promise<ParquetReadResult> {
    return this.readColumns(null, options);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a ParquetReader from a URL string
 *
 * @example
 * ```typescript
 * const reader = createParquetReader('https://datasets.clickhouse.com/hits_compatible/hits.parquet');
 * const metadata = await reader.getMetadata();
 * console.log(`File has ${metadata.rowCount} rows`);
 * ```
 */
export function createParquetReader(url: string, fetchFn?: typeof fetch): ParquetReader {
  return new ParquetReader(url, fetchFn);
}

/**
 * Read columns from a Parquet URL in one call
 *
 * @example
 * ```typescript
 * const result = await readParquetUrl(
 *   'https://datasets.clickhouse.com/hits_compatible/hits.parquet',
 *   ['CounterID', 'UserID'],
 *   { limit: 1000 }
 * );
 * ```
 */
export async function readParquetUrl(
  url: string,
  columns: string[] | null,
  options: Omit<ParquetReadOptions, 'columns'> = {},
  fetchFn?: typeof fetch
): Promise<ParquetReadResult> {
  const reader = new ParquetReader(url, fetchFn);
  return reader.readColumns(columns, options);
}

/**
 * Get metadata from a Parquet URL
 */
export async function getParquetUrlMetadata(
  url: string,
  fetchFn?: typeof fetch
): Promise<ParquetFileMetadata> {
  const reader = new ParquetReader(url, fetchFn);
  return reader.getMetadata();
}
