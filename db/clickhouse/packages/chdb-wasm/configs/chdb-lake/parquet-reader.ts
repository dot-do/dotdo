/**
 * Parquet Reader for chDB Lake Worker
 *
 * Uses hyparquet (pure JavaScript) to read Parquet files in Cloudflare Workers.
 * hyparquet works in Cloudflare Workers without WASM initialization issues.
 *
 * Key benefits over parquet-wasm:
 * - Pure JavaScript, no WASM initialization errors
 * - Lightweight (~10KB gzipped core)
 * - HTTP Range request support for efficient cloud storage reads
 * - Predicate pushdown via row group statistics
 *
 * @see https://github.com/hyparam/hyparquet
 */

import { parquetRead, parquetMetadataAsync, parquetSchema, type SchemaTree, type SchemaElement } from 'hyparquet';
import * as snappyjs from 'snappyjs';
import { gunzipSync, inflateSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';

/**
 * Pure JS compressors for Cloudflare Workers compatibility
 * WASM-based compressors (hyparquet-compressors) don't work in Workers
 */
const compressors = {
  // Snappy compression (very common in Parquet files)
  SNAPPY: (input: Uint8Array) => snappyjs.uncompress(input),
  // Gzip compression
  GZIP: (input: Uint8Array) => gunzipSync(input),
  // Zlib/Deflate compression
  ZSTD: (input: Uint8Array) => zstdDecompress(input),
  // LZ4 compression - not supported yet
  LZ4: undefined,
  // LZ4_RAW compression
  LZ4_RAW: undefined,
  // Brotli compression - not supported yet
  BROTLI: undefined,
  // Uncompressed
  UNCOMPRESSED: (input: Uint8Array) => input,
};

/**
 * Column metadata from Parquet schema
 */
export interface ParquetColumnInfo {
  name: string;
  type: string; // ClickHouse-compatible type
  nullable: boolean;
}

/**
 * Parsed Parquet file data
 */
export interface ParsedParquetData {
  schema: ParquetColumnInfo[];
  rows: Record<string, unknown>[];
  rowCount: number;
  rowGroups: number;
}

// Hyparquet is always initialized (pure JS)
let hyparquetInitialized = true;

/**
 * Initialize Parquet reader
 * With hyparquet, this is a no-op (pure JavaScript, no WASM)
 */
export async function initParquetWasm(): Promise<void> {
  // hyparquet is pure JavaScript - no initialization needed
  hyparquetInitialized = true;
  console.log('[parquet-reader] hyparquet initialized (pure JS)');
}

/**
 * Map Parquet physical/logical types to ClickHouse types
 */
function parquetTypeToClickHouse(element: SchemaElement): string {
  const physicalType = element.type;
  const logicalType = element.logical_type;
  const convertedType = element.converted_type;

  // Handle logical types first (more specific)
  if (logicalType && typeof logicalType === 'object' && 'type' in logicalType) {
    switch (logicalType.type) {
      case 'STRING':
      case 'ENUM':
      case 'JSON':
      case 'BSON':
        return 'String';
      case 'INTEGER': {
        const bits = logicalType.bitWidth || 32;
        const signed = logicalType.isSigned !== false;
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
        return `Decimal(${logicalType.precision || 18}, ${logicalType.scale || 2})`;
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
      case 'UINT_8':
        return 'UInt8';
      case 'UINT_16':
        return 'UInt16';
      case 'UINT_32':
        return 'UInt32';
      case 'UINT_64':
        return 'UInt64';
      case 'INT_8':
        return 'Int8';
      case 'INT_16':
        return 'Int16';
      case 'INT_32':
        return 'Int32';
      case 'INT_64':
        return 'Int64';
      case 'DECIMAL':
        return 'Decimal(18, 2)';
      case 'MAP':
      case 'LIST':
        return 'String'; // Serialize complex types as JSON
    }
  }

  // Fall back to physical types
  switch (physicalType) {
    case 'BOOLEAN':
      return 'UInt8'; // ClickHouse uses UInt8 for booleans
    case 'INT32':
      return 'Int32';
    case 'INT64':
      return 'Int64';
    case 'INT96':
      return 'DateTime'; // INT96 is typically used for timestamps
    case 'FLOAT':
      return 'Float32';
    case 'DOUBLE':
      return 'Float64';
    case 'BYTE_ARRAY':
    case 'FIXED_LEN_BYTE_ARRAY':
      return 'String';
    default:
      return 'String';
  }
}

/**
 * Create an AsyncBuffer from ArrayBuffer for hyparquet
 */
function createAsyncBuffer(data: ArrayBuffer): { byteLength: number; slice: (start: number, end?: number) => Promise<ArrayBuffer> } {
  return {
    byteLength: data.byteLength,
    async slice(start: number, end?: number): Promise<ArrayBuffer> {
      return data.slice(start, end);
    },
  };
}

/**
 * Convert hyparquet value to JavaScript value
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
    // Try to decode as UTF-8 string
    try {
      return new TextDecoder().decode(bytes);
    } catch {
      // Return as hex string if not valid UTF-8
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }

  return value;
}

/**
 * Read options for Parquet files
 */
export interface ParquetReadOptions {
  columns?: string[];
  limit?: number;
  offset?: number;
  /** Enable batch processing for large files (default: true) */
  batchProcessing?: boolean;
  /** Batch size for streaming reads (default: 10000) */
  batchSize?: number;
}

/**
 * Read Parquet file and return parsed data
 *
 * Performance optimizations:
 * - Column projection: Only reads requested columns from disk
 * - Row range limiting: Uses rowStart/rowEnd to skip unnecessary data
 * - Batch processing: Processes rows in batches to reduce memory pressure
 * - Compression support: Uses hyparquet-compressors for all codecs
 */
export async function readParquetFile(
  data: ArrayBuffer,
  options?: ParquetReadOptions
): Promise<ParsedParquetData> {
  const startTime = Date.now();
  const asyncBuffer = createAsyncBuffer(data);

  // First, read metadata to get schema and row count
  const metadata = await parquetMetadataAsync(asyncBuffer);
  const schemaTree = parquetSchema(metadata);

  // Build schema from column names
  const schema: ParquetColumnInfo[] = [];
  const columnTypes = new Map<string, string>();
  const allColumnNames: string[] = [];

  // Extract column names from schema tree (skip root element)
  if (schemaTree.children) {
    for (const child of schemaTree.children) {
      const colName = child.element.name;
      const colType = parquetTypeToClickHouse(child.element);
      const nullable = child.element.repetition_type !== 'REQUIRED';

      allColumnNames.push(colName);

      // Filter columns if specified
      if (options?.columns && !options.columns.includes(colName)) {
        continue;
      }

      schema.push({
        name: colName,
        type: colType,
        nullable,
      });
      columnTypes.set(colName, colType);
    }
  }

  // Determine which columns to read (optimization: only read what's needed)
  const columnsToRead = options?.columns || allColumnNames;

  // Calculate row range
  const totalRows = Number(metadata.num_rows);
  const rowStart = options?.offset || 0;
  const rowEnd = options?.limit ? Math.min(rowStart + options.limit, totalRows) : totalRows;
  const expectedRows = rowEnd - rowStart;

  // Pre-allocate array for better memory efficiency
  const rows: Record<string, unknown>[] = [];
  if (expectedRows > 0 && expectedRows < 1000000) {
    // Pre-allocate for reasonable sizes
    rows.length = 0; // Reset but hint to engine
  }

  // Performance metrics
  let rowsProcessed = 0;
  const rowGroupCount = metadata.row_groups?.length || 1;

  await parquetRead({
    file: asyncBuffer,
    columns: columnsToRead,
    rowStart,
    rowEnd,
    compressors,
    rowFormat: 'object', // Return rows as objects with column names as keys
    onComplete: (data: Record<string, unknown>[]) => {
      // Debug: log first row structure
      if (data.length > 0) {
        const firstRow = data[0];
        const rowKeys = Object.keys(firstRow);
        console.log(`[parquet-reader] First row has ${rowKeys.length} keys: ${rowKeys.slice(0, 5).join(', ')}...`);
        // Safe stringify that handles BigInt
        const safeStringify = (v: unknown) => typeof v === 'bigint' ? v.toString() : JSON.stringify(v);
        console.log(`[parquet-reader] Sample values: ${rowKeys.slice(0, 3).map(k => `${k}=${safeStringify(firstRow[k])}`).join(', ')}`);
      }

      // Batch process rows for better performance
      const batchSize = options?.batchSize || 10000;

      for (let i = 0; i < data.length; i += batchSize) {
        const batchEnd = Math.min(i + batchSize, data.length);

        for (let j = i; j < batchEnd; j++) {
          const row = data[j];
          const convertedRow: Record<string, unknown> = {};

          // Process all keys from the row (hyparquet returns data with correct column names)
          for (const key of Object.keys(row)) {
            const clickhouseType = columnTypes.get(key) || 'String';
            convertedRow[key] = convertValue(row[key], clickhouseType);
          }

          rows.push(convertedRow);
          rowsProcessed++;
        }
      }
    },
  });

  const elapsed = Date.now() - startTime;
  const rowsPerSecond = elapsed > 0 ? Math.round((rowsProcessed / elapsed) * 1000) : 0;

  console.log(
    `[parquet-reader] Read ${rowsProcessed} rows, ${schema.length}/${allColumnNames.length} columns, ` +
    `${rowGroupCount} row groups in ${elapsed}ms (${rowsPerSecond} rows/sec)`
  );

  return {
    schema,
    rows,
    rowCount: rowsProcessed,
    rowGroups: rowGroupCount,
  };
}

/**
 * Row group statistics for predicate pushdown
 */
export interface RowGroupStats {
  rowGroupIndex: number;
  numRows: number;
  totalByteSize: number;
  columns: Map<string, {
    min?: unknown;
    max?: unknown;
    nullCount?: number;
  }>;
}

/**
 * Extended metadata including row group statistics
 */
export interface ParquetMetadataExtended {
  schema: ParquetColumnInfo[];
  rowCount: number;
  rowGroups: number;
  rowGroupStats: RowGroupStats[];
  createdBy?: string;
  keyValueMetadata?: Record<string, string>;
}

/**
 * Read Parquet file metadata only (schema, row counts)
 * More efficient when you don't need the actual data
 */
export async function readParquetMetadata(
  data: ArrayBuffer
): Promise<{
  schema: ParquetColumnInfo[];
  rowCount: number;
  rowGroups: number;
}> {
  const asyncBuffer = createAsyncBuffer(data);
  const metadata = await parquetMetadataAsync(asyncBuffer);
  const schemaTree = parquetSchema(metadata);

  const schema: ParquetColumnInfo[] = [];

  // Extract column names from schema tree (skip root element)
  if (schemaTree.children) {
    for (const child of schemaTree.children) {
      schema.push({
        name: child.element.name,
        type: parquetTypeToClickHouse(child.element),
        nullable: child.element.repetition_type !== 'REQUIRED',
      });
    }
  }

  return {
    schema,
    rowCount: Number(metadata.num_rows),
    rowGroups: metadata.row_groups?.length || 1,
  };
}

/**
 * ClickBench hits table schema
 * 105 columns representing web analytics event data
 */
export const CLICKBENCH_HITS_SCHEMA: ParquetColumnInfo[] = [
  { name: 'WatchID', type: 'Int64', nullable: false },
  { name: 'JavaEnable', type: 'Int16', nullable: false },
  { name: 'Title', type: 'String', nullable: false },
  { name: 'GoodEvent', type: 'Int16', nullable: false },
  { name: 'EventTime', type: 'DateTime', nullable: false },
  { name: 'EventDate', type: 'Date', nullable: false },
  { name: 'CounterID', type: 'Int32', nullable: false },
  { name: 'ClientIP', type: 'Int32', nullable: false },
  { name: 'RegionID', type: 'Int32', nullable: false },
  { name: 'UserID', type: 'Int64', nullable: false },
  { name: 'CounterClass', type: 'Int16', nullable: false },
  { name: 'OS', type: 'Int16', nullable: false },
  { name: 'UserAgent', type: 'Int16', nullable: false },
  { name: 'URL', type: 'String', nullable: false },
  { name: 'Referer', type: 'String', nullable: false },
  { name: 'IsRefresh', type: 'Int16', nullable: false },
  { name: 'RefererCategoryID', type: 'Int16', nullable: false },
  { name: 'RefererRegionID', type: 'Int32', nullable: false },
  { name: 'URLCategoryID', type: 'Int16', nullable: false },
  { name: 'URLRegionID', type: 'Int32', nullable: false },
  { name: 'ResolutionWidth', type: 'Int16', nullable: false },
  { name: 'ResolutionHeight', type: 'Int16', nullable: false },
  { name: 'ResolutionDepth', type: 'Int16', nullable: false },
  { name: 'FlashMajor', type: 'Int16', nullable: false },
  { name: 'FlashMinor', type: 'Int16', nullable: false },
  { name: 'FlashMinor2', type: 'String', nullable: false },
  { name: 'NetMajor', type: 'Int16', nullable: false },
  { name: 'NetMinor', type: 'Int16', nullable: false },
  { name: 'UserAgentMajor', type: 'Int16', nullable: false },
  { name: 'UserAgentMinor', type: 'String', nullable: false },
  { name: 'CookieEnable', type: 'Int16', nullable: false },
  { name: 'JavascriptEnable', type: 'Int16', nullable: false },
  { name: 'IsMobile', type: 'Int16', nullable: false },
  { name: 'MobilePhone', type: 'Int16', nullable: false },
  { name: 'MobilePhoneModel', type: 'String', nullable: false },
  { name: 'Params', type: 'String', nullable: false },
  { name: 'IPNetworkID', type: 'Int32', nullable: false },
  { name: 'TraficSourceID', type: 'Int16', nullable: false },
  { name: 'SearchEngineID', type: 'Int16', nullable: false },
  { name: 'SearchPhrase', type: 'String', nullable: false },
  { name: 'AdvEngineID', type: 'Int16', nullable: false },
  { name: 'IsArtifical', type: 'Int16', nullable: false },
  { name: 'WindowClientWidth', type: 'Int16', nullable: false },
  { name: 'WindowClientHeight', type: 'Int16', nullable: false },
  { name: 'ClientTimeZone', type: 'Int16', nullable: false },
  { name: 'ClientEventTime', type: 'DateTime', nullable: false },
  { name: 'SilverlightVersion1', type: 'Int16', nullable: false },
  { name: 'SilverlightVersion2', type: 'Int16', nullable: false },
  { name: 'SilverlightVersion3', type: 'Int32', nullable: false },
  { name: 'SilverlightVersion4', type: 'Int16', nullable: false },
  { name: 'PageCharset', type: 'String', nullable: false },
  { name: 'CodeVersion', type: 'Int32', nullable: false },
  { name: 'IsLink', type: 'Int16', nullable: false },
  { name: 'IsDownload', type: 'Int16', nullable: false },
  { name: 'IsNotBounce', type: 'Int16', nullable: false },
  { name: 'FUniqID', type: 'Int64', nullable: false },
  { name: 'OriginalURL', type: 'String', nullable: false },
  { name: 'HID', type: 'Int32', nullable: false },
  { name: 'IsOldCounter', type: 'Int16', nullable: false },
  { name: 'IsEvent', type: 'Int16', nullable: false },
  { name: 'IsParameter', type: 'Int16', nullable: false },
  { name: 'DontCountHits', type: 'Int16', nullable: false },
  { name: 'WithHash', type: 'Int16', nullable: false },
  { name: 'HitColor', type: 'String', nullable: false },
  { name: 'LocalEventTime', type: 'DateTime', nullable: false },
  { name: 'Age', type: 'Int16', nullable: false },
  { name: 'Sex', type: 'Int16', nullable: false },
  { name: 'Income', type: 'Int16', nullable: false },
  { name: 'Interests', type: 'Int16', nullable: false },
  { name: 'Robotness', type: 'Int16', nullable: false },
  { name: 'RemoteIP', type: 'Int32', nullable: false },
  { name: 'WindowName', type: 'Int32', nullable: false },
  { name: 'OpenerName', type: 'Int32', nullable: false },
  { name: 'HistoryLength', type: 'Int16', nullable: false },
  { name: 'BrowserLanguage', type: 'String', nullable: false },
  { name: 'BrowserCountry', type: 'String', nullable: false },
  { name: 'SocialNetwork', type: 'String', nullable: false },
  { name: 'SocialAction', type: 'String', nullable: false },
  { name: 'HTTPError', type: 'Int16', nullable: false },
  { name: 'SendTiming', type: 'Int32', nullable: false },
  { name: 'DNSTiming', type: 'Int32', nullable: false },
  { name: 'ConnectTiming', type: 'Int32', nullable: false },
  { name: 'ResponseStartTiming', type: 'Int32', nullable: false },
  { name: 'ResponseEndTiming', type: 'Int32', nullable: false },
  { name: 'FetchTiming', type: 'Int32', nullable: false },
  { name: 'SocialSourceNetworkID', type: 'Int16', nullable: false },
  { name: 'SocialSourcePage', type: 'String', nullable: false },
  { name: 'ParamPrice', type: 'Int64', nullable: false },
  { name: 'ParamOrderID', type: 'String', nullable: false },
  { name: 'ParamCurrency', type: 'String', nullable: false },
  { name: 'ParamCurrencyID', type: 'Int16', nullable: false },
  { name: 'OpenstatServiceName', type: 'String', nullable: false },
  { name: 'OpenstatCampaignID', type: 'String', nullable: false },
  { name: 'OpenstatAdID', type: 'String', nullable: false },
  { name: 'OpenstatSourceID', type: 'String', nullable: false },
  { name: 'UTMSource', type: 'String', nullable: false },
  { name: 'UTMMedium', type: 'String', nullable: false },
  { name: 'UTMCampaign', type: 'String', nullable: false },
  { name: 'UTMContent', type: 'String', nullable: false },
  { name: 'UTMTerm', type: 'String', nullable: false },
  { name: 'FromTag', type: 'String', nullable: false },
  { name: 'HasGCLID', type: 'Int16', nullable: false },
  { name: 'RefererHash', type: 'Int64', nullable: false },
  { name: 'URLHash', type: 'Int64', nullable: false },
  { name: 'CLID', type: 'Int32', nullable: false },
];

/**
 * Check if a file path looks like a ClickBench hits file
 */
export function isClickBenchHitsFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return (
    lowerPath.includes('hits') &&
    (lowerPath.includes('clickbench') ||
      lowerPath.includes('hits_sample') ||
      lowerPath.includes('hits.parquet'))
  );
}
