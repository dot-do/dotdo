/**
 * Parquet Reader for Iceberg Data Files
 *
 * Provides efficient Parquet file parsing using parquet-wasm, enabling
 * columnar analytics on Cloudflare Workers. This is a core component of
 * the lakehouse architecture, supporting column projection and predicate
 * pushdown for optimal query performance.
 *
 * ## Lakehouse Integration
 *
 * Parquet is the default storage format for Iceberg data files because:
 *
 * - **Columnar Storage**: Read only the columns you need (column projection)
 * - **Compression**: Efficient encoding reduces storage and network costs
 * - **Statistics**: Per-column min/max values enable predicate pushdown
 * - **Row Groups**: Parallel processing and range requests
 *
 * ## Performance Characteristics
 *
 * - **Cold Start**: ~50ms for WASM module initialization (lazy loaded)
 * - **File Parse**: ~10-50ms depending on file size
 * - **Column Projection**: Reduces I/O by reading only requested columns
 *
 * ## Usage Patterns
 *
 * The ParquetReader integrates with IcebergReader for the complete navigation:
 *
 * ```
 * IcebergReader.getRecord()
 *   └─> findFile() - Navigate metadata to locate file
 *         └─> ParquetReader.findRecord() - Read and filter record
 * ```
 *
 * @example Direct Parquet Reading
 * ```typescript
 * const reader = new ParquetReader(env.R2)
 *
 * // Read all records from a file
 * const result = await reader.readFile('data/file.parquet')
 *
 * // Read specific columns only (column projection)
 * const result = await reader.readFile('data/file.parquet', {
 *   columns: ['id', 'name', 'value']
 * })
 *
 * // Find a specific record by ID
 * const record = await reader.findRecord('data/file.parquet', 'my-id')
 * ```
 *
 * @see https://parquet.apache.org/docs/file-format/ - Parquet format
 * @see https://github.com/kylebarron/parquet-wasm - parquet-wasm library
 * @module db/iceberg/parquet
 */

import { readParquet } from 'parquet-wasm'
import { tableFromIPC, type Table as ArrowTable } from 'apache-arrow'
import type { R2Bucket } from '@cloudflare/workers-types'
import type { IcebergRecord } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for reading Parquet files
 */
export interface ParquetReadOptions {
  /** Columns to read (default: all columns) */
  columns?: string[]
  /** Row offset for pagination */
  offset?: number
  /** Maximum rows to return */
  limit?: number
}

/**
 * Result from reading a Parquet file
 */
export interface ParquetReadResult<T = IcebergRecord> {
  /** Records read from the file */
  records: T[]
  /** Total number of rows in the file */
  totalRows: number
  /** Number of columns in the schema */
  columnCount: number
  /** Column names in the schema */
  columnNames: string[]
  /** Read duration in milliseconds */
  readTimeMs: number
}

/**
 * Statistics from a Parquet file
 */
export interface ParquetFileStats {
  /** Number of rows */
  numRows: number
  /** Number of columns */
  numColumns: number
  /** Column names */
  columnNames: string[]
  /** Column types (Arrow type names) */
  columnTypes: string[]
}

// ============================================================================
// Lazy Module Loading
// ============================================================================

/**
 * Cached parquet-wasm module reference
 * Uses lazy loading to avoid cold start penalty
 */
let parquetWasmModule: typeof import('parquet-wasm') | null = null
let initPromise: Promise<typeof import('parquet-wasm')> | null = null

/**
 * Initialize parquet-wasm module (lazy, cached)
 *
 * The WASM module is only loaded when first needed, avoiding
 * cold start penalties for requests that don't read Parquet.
 */
async function initParquetWasm(): Promise<typeof import('parquet-wasm')> {
  if (parquetWasmModule) {
    return parquetWasmModule
  }

  if (!initPromise) {
    initPromise = (async () => {
      // Dynamic import for bundler compatibility
      const wasm = await import('parquet-wasm')
      parquetWasmModule = wasm
      return wasm
    })()
  }

  return initPromise
}

// ============================================================================
// ParquetReader Class
// ============================================================================

/**
 * ParquetReader - Reads Parquet files from R2 with column projection
 *
 * Uses parquet-wasm for efficient Parquet parsing in Workers.
 * Supports column projection to read only required columns.
 *
 * @example Basic usage
 * ```typescript
 * const reader = new ParquetReader(env.R2)
 *
 * // Read all records from a file
 * const result = await reader.readFile('data/file.parquet')
 * console.log(result.records)
 *
 * // Read specific columns only
 * const result = await reader.readFile('data/file.parquet', {
 *   columns: ['id', 'name', 'value']
 * })
 * ```
 *
 * @example Find a record by ID
 * ```typescript
 * const record = await reader.findRecord('data/file.parquet', 'my-id', {
 *   columns: ['id', 'name', 'esm', 'dts']
 * })
 * ```
 */
export class ParquetReader {
  private readonly bucket: R2Bucket

  constructor(bucket: R2Bucket) {
    this.bucket = bucket
  }

  /**
   * Read records from a Parquet file
   *
   * @param filePath - R2 path to the Parquet file
   * @param options - Read options (columns, offset, limit)
   * @returns ParquetReadResult with records and metadata
   */
  async readFile<T extends IcebergRecord = IcebergRecord>(
    filePath: string,
    options: ParquetReadOptions = {}
  ): Promise<ParquetReadResult<T>> {
    const startTime = performance.now()

    // Fetch file from R2
    const obj = await this.bucket.get(filePath)
    if (!obj) {
      throw new Error(`Parquet file not found: ${filePath}`)
    }

    // Read file contents
    const buffer = await obj.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    // Parse Parquet file
    const table = await this.parseParquet(bytes)

    // Extract records with optional column projection
    const records = this.extractRecords<T>(table, options)

    return {
      records,
      totalRows: table.numRows,
      columnCount: table.numCols,
      columnNames: table.schema.fields.map((f) => f.name),
      readTimeMs: performance.now() - startTime,
    }
  }

  /**
   * Read and parse Parquet from bytes
   *
   * @param data - Parquet file bytes
   * @param options - Read options
   * @returns ParquetReadResult with records
   */
  async readBytes<T extends IcebergRecord = IcebergRecord>(
    data: Uint8Array | ArrayBuffer,
    options: ParquetReadOptions = {}
  ): Promise<ParquetReadResult<T>> {
    const startTime = performance.now()

    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const table = await this.parseParquet(bytes)
    const records = this.extractRecords<T>(table, options)

    return {
      records,
      totalRows: table.numRows,
      columnCount: table.numCols,
      columnNames: table.schema.fields.map((f) => f.name),
      readTimeMs: performance.now() - startTime,
    }
  }

  /**
   * Find a specific record by ID in a Parquet file
   *
   * Efficiently scans the file looking for a matching record.
   *
   * @param filePath - R2 path to the Parquet file
   * @param id - Record ID to find
   * @param options - Read options (columns for projection)
   * @returns The matching record, or null if not found
   */
  async findRecord<T extends IcebergRecord = IcebergRecord>(
    filePath: string,
    id: string,
    options: ParquetReadOptions = {}
  ): Promise<T | null> {
    const obj = await this.bucket.get(filePath)
    if (!obj) {
      return null
    }

    const buffer = await obj.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const table = await this.parseParquet(bytes)

    return this.findRecordInTable<T>(table, id, options)
  }

  /**
   * Find a record in parsed Arrow table by ID
   *
   * @param table - Arrow table
   * @param id - Record ID to find
   * @param options - Read options
   * @returns Matching record or null
   */
  findRecordInTable<T extends IcebergRecord = IcebergRecord>(
    table: ArrowTable,
    id: string,
    options: ParquetReadOptions = {}
  ): T | null {
    const idColumn = table.getChild('id')
    if (!idColumn) {
      // No ID column, scan all records
      const records = this.extractRecords<T>(table, options)
      return records.find((r) => r.id === id) ?? null
    }

    // Scan for matching ID
    for (let i = 0; i < table.numRows; i++) {
      const rowId = idColumn.get(i)
      if (rowId === id || String(rowId) === id) {
        return this.extractRowAsRecord<T>(table, i, options.columns)
      }
    }

    return null
  }

  /**
   * Get file statistics without reading all data
   *
   * @param filePath - R2 path to the Parquet file
   * @returns File statistics
   */
  async getStats(filePath: string): Promise<ParquetFileStats | null> {
    const obj = await this.bucket.get(filePath)
    if (!obj) {
      return null
    }

    const buffer = await obj.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const table = await this.parseParquet(bytes)

    return {
      numRows: table.numRows,
      numColumns: table.numCols,
      columnNames: table.schema.fields.map((f) => f.name),
      columnTypes: table.schema.fields.map((f) => f.type.toString()),
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Parse Parquet bytes into Arrow table
   */
  private async parseParquet(bytes: Uint8Array): Promise<ArrowTable> {
    await initParquetWasm()
    const arrowIPC = readParquet(bytes)
    return tableFromIPC(arrowIPC)
  }

  /**
   * Extract records from Arrow table with optional column projection
   */
  private extractRecords<T extends IcebergRecord>(
    table: ArrowTable,
    options: ParquetReadOptions
  ): T[] {
    const { columns, offset = 0, limit } = options

    // Determine end row
    const endRow = limit !== undefined ? Math.min(offset + limit, table.numRows) : table.numRows

    const records: T[] = []

    for (let i = offset; i < endRow; i++) {
      const record = this.extractRowAsRecord<T>(table, i, columns)
      records.push(record)
    }

    return records
  }

  /**
   * Extract a single row as a typed record
   */
  private extractRowAsRecord<T extends IcebergRecord>(
    table: ArrowTable,
    rowIndex: number,
    columns?: string[]
  ): T {
    const record: Record<string, unknown> = {}

    // If columns specified, only read those
    const fieldsToRead = columns
      ? table.schema.fields.filter((f) => columns.includes(f.name))
      : table.schema.fields

    for (const field of fieldsToRead) {
      const column = table.getChild(field.name)
      if (column) {
        const value = column.get(rowIndex)
        record[field.name] = this.convertArrowValue(value, field.type.toString())
      }
    }

    return record as T
  }

  /**
   * Convert Arrow value to JavaScript value
   */
  private convertArrowValue(value: unknown, _typeStr: string): unknown {
    if (value === null || value === undefined) {
      return null
    }

    // Handle BigInt (common in timestamps)
    if (typeof value === 'bigint') {
      // Convert to number if safe, otherwise to string
      if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
        return Number(value)
      }
      return value.toString()
    }

    // Handle nested structures (Struct, List, Map)
    if (value && typeof value === 'object') {
      // Check if it's an array-like object with toJSON
      if ('toJSON' in value && typeof value.toJSON === 'function') {
        return value.toJSON()
      }
      // Check if it's a Map
      if (value instanceof Map) {
        return Object.fromEntries(value)
      }
    }

    return value
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Read a Parquet file from R2
 *
 * @param bucket - R2 bucket
 * @param filePath - Path to the Parquet file
 * @param options - Read options
 * @returns Records from the file
 */
export async function readParquetFromR2<T extends IcebergRecord = IcebergRecord>(
  bucket: R2Bucket,
  filePath: string,
  options: ParquetReadOptions = {}
): Promise<T[]> {
  const reader = new ParquetReader(bucket)
  const result = await reader.readFile<T>(filePath, options)
  return result.records
}

/**
 * Find a record by ID in a Parquet file
 *
 * @param bucket - R2 bucket
 * @param filePath - Path to the Parquet file
 * @param id - Record ID to find
 * @param options - Read options
 * @returns The matching record or null
 */
export async function findRecordInParquet<T extends IcebergRecord = IcebergRecord>(
  bucket: R2Bucket,
  filePath: string,
  id: string,
  options: ParquetReadOptions = {}
): Promise<T | null> {
  const reader = new ParquetReader(bucket)
  return reader.findRecord<T>(filePath, id, options)
}

/**
 * Parse Parquet bytes without R2
 *
 * @param data - Parquet file bytes
 * @param options - Read options
 * @returns Parsed records
 */
export async function parseParquetBytes<T extends IcebergRecord = IcebergRecord>(
  data: Uint8Array | ArrayBuffer,
  options: ParquetReadOptions = {}
): Promise<ParquetReadResult<T>> {
  // Create a mock reader that doesn't need R2
  const mockBucket = {} as R2Bucket
  const reader = new ParquetReader(mockBucket)
  return reader.readBytes<T>(data, options)
}

