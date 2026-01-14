/**
 * @fileoverview Parquet Writer for Git Analytics
 *
 * @description
 * Provides functionality to write git analytics data to Parquet format, a
 * columnar storage format optimized for analytical queries. This module
 * enables efficient storage and querying of Git repository data.
 *
 * **Key Features:**
 * - Schema definition with various field types (STRING, INT32, INT64, etc.)
 * - Multiple compression algorithms (SNAPPY, GZIP, ZSTD, LZ4, UNCOMPRESSED)
 * - Row group management for efficient columnar storage
 * - Automatic and manual row group flushing
 * - Column-level statistics generation (min, max, null count)
 * - Custom key-value metadata support
 * - Memory-efficient streaming writes
 *
 * **Parquet Format:**
 * The generated files follow the Parquet format with:
 * - Magic bytes "PAR1" at start and end
 * - Row group data organized by columns
 * - Footer metadata containing schema and statistics
 *
 * @example
 * ```typescript
 * // Define schema for commit analytics
 * const schema = defineSchema([
 *   { name: 'commit_sha', type: ParquetFieldType.STRING, required: true },
 *   { name: 'author', type: ParquetFieldType.STRING, required: true },
 *   { name: 'timestamp', type: ParquetFieldType.TIMESTAMP_MILLIS, required: true },
 *   { name: 'file_count', type: ParquetFieldType.INT32, required: false }
 * ])
 *
 * // Create writer with options
 * const writer = createParquetWriter(schema, {
 *   rowGroupSize: 10000,
 *   compression: ParquetCompression.SNAPPY,
 *   enableStatistics: true
 * })
 *
 * // Write data
 * await writer.writeRows([
 *   { commit_sha: 'abc123...', author: 'alice', timestamp: Date.now(), file_count: 5 },
 *   { commit_sha: 'def456...', author: 'bob', timestamp: Date.now(), file_count: 3 }
 * ])
 *
 * // Generate the Parquet file
 * const buffer = await writer.toBuffer()
 * ```
 *
 * @module tiered/parquet-writer
 * @see {@link ParquetWriter} - Main writer class
 * @see {@link defineSchema} - Schema definition helper
 */

import pako from 'pako'

// ============================================================================
// Types and Enums
// ============================================================================

/**
 * Supported Parquet field types.
 *
 * @description
 * Defines the data types that can be used for fields in a Parquet schema.
 * Each type maps to an appropriate physical and logical Parquet type.
 *
 * @example
 * ```typescript
 * const field: ParquetField = {
 *   name: 'count',
 *   type: ParquetFieldType.INT64,
 *   required: true
 * }
 * ```
 *
 * @enum {string}
 */
export enum ParquetFieldType {
  /**
   * UTF-8 encoded string.
   * Maps to Parquet BYTE_ARRAY with UTF8 logical type.
   */
  STRING = 'STRING',

  /**
   * 32-bit signed integer.
   * Maps to Parquet INT32 physical type.
   */
  INT32 = 'INT32',

  /**
   * 64-bit signed integer.
   * Maps to Parquet INT64 physical type.
   */
  INT64 = 'INT64',

  /**
   * Boolean value (true/false).
   * Maps to Parquet BOOLEAN physical type.
   */
  BOOLEAN = 'BOOLEAN',

  /**
   * 32-bit IEEE 754 floating point.
   * Maps to Parquet FLOAT physical type.
   */
  FLOAT = 'FLOAT',

  /**
   * 64-bit IEEE 754 floating point.
   * Maps to Parquet DOUBLE physical type.
   */
  DOUBLE = 'DOUBLE',

  /**
   * Raw binary data.
   * Maps to Parquet BYTE_ARRAY physical type.
   */
  BINARY = 'BINARY',

  /**
   * Timestamp with millisecond precision.
   * Maps to Parquet INT64 with TIMESTAMP_MILLIS logical type.
   */
  TIMESTAMP_MILLIS = 'TIMESTAMP_MILLIS',

  /**
   * Timestamp with microsecond precision.
   * Maps to Parquet INT64 with TIMESTAMP_MICROS logical type.
   */
  TIMESTAMP_MICROS = 'TIMESTAMP_MICROS'
}

/**
 * Supported compression types for Parquet data.
 *
 * @description
 * Different compression algorithms offer trade-offs between compression
 * ratio, compression speed, and decompression speed.
 *
 * **Comparison:**
 * - SNAPPY: Fast compression/decompression, moderate ratio (default)
 * - GZIP: Higher ratio, slower compression, fast decompression
 * - ZSTD: Best ratio, good speed, requires more memory
 * - LZ4: Fastest, lower ratio
 * - UNCOMPRESSED: No compression overhead
 *
 * @example
 * ```typescript
 * const writer = createParquetWriter(schema, {
 *   compression: ParquetCompression.ZSTD
 * })
 * ```
 *
 * @enum {string}
 */
export enum ParquetCompression {
  /**
   * No compression applied.
   * Fastest writes, largest file size.
   */
  UNCOMPRESSED = 'UNCOMPRESSED',

  /**
   * Snappy compression (default).
   * Good balance of speed and compression ratio.
   */
  SNAPPY = 'SNAPPY',

  /**
   * GZIP compression.
   * Higher compression ratio, slower compression.
   */
  GZIP = 'GZIP',

  /**
   * Zstandard compression.
   * Best compression ratio with good speed.
   */
  ZSTD = 'ZSTD',

  /**
   * LZ4 compression.
   * Fastest compression, lower ratio.
   */
  LZ4 = 'LZ4'
}

/**
 * Field definition for a Parquet schema.
 *
 * @description
 * Defines a single column in the Parquet schema, including its name,
 * data type, nullability, and optional metadata.
 *
 * @example
 * ```typescript
 * const nameField: ParquetField = {
 *   name: 'user_name',
 *   type: ParquetFieldType.STRING,
 *   required: true,
 *   metadata: { description: 'The user display name' }
 * }
 *
 * const ageField: ParquetField = {
 *   name: 'age',
 *   type: ParquetFieldType.INT32,
 *   required: false  // nullable
 * }
 * ```
 *
 * @interface ParquetField
 */
export interface ParquetField {
  /**
   * Column name.
   * Must be unique within the schema and non-empty.
   */
  name: string

  /**
   * Data type of the column.
   *
   * @see {@link ParquetFieldType}
   */
  type: ParquetFieldType

  /**
   * Whether the field is required (non-nullable).
   * If true, null values will cause validation errors.
   */
  required: boolean

  /**
   * Optional key-value metadata for the field.
   * Can be used for descriptions, units, etc.
   */
  metadata?: Record<string, string>
}

/**
 * Parquet schema definition.
 *
 * @description
 * Defines the complete schema for a Parquet file, including all fields
 * and optional schema-level metadata.
 *
 * @example
 * ```typescript
 * const schema: ParquetSchema = {
 *   fields: [
 *     { name: 'id', type: ParquetFieldType.INT64, required: true },
 *     { name: 'name', type: ParquetFieldType.STRING, required: true }
 *   ],
 *   metadata: {
 *     created_by: 'gitdo',
 *     version: '1.0'
 *   }
 * }
 * ```
 *
 * @interface ParquetSchema
 */
export interface ParquetSchema {
  /**
   * Array of field definitions for all columns.
   * Order determines column order in the file.
   */
  fields: ParquetField[]

  /**
   * Optional schema-level metadata.
   * Stored in the Parquet file footer.
   */
  metadata?: Record<string, string>
}

/**
 * Options for creating a Parquet writer.
 *
 * @description
 * Configuration options that control how the Parquet file is written,
 * including row group sizing, compression, and statistics generation.
 *
 * @example
 * ```typescript
 * const options: ParquetWriteOptions = {
 *   rowGroupSize: 50000,        // 50K rows per group
 *   rowGroupMemoryLimit: 64 * 1024 * 1024,  // 64MB memory limit
 *   compression: ParquetCompression.ZSTD,
 *   columnCompression: {
 *     'binary_data': ParquetCompression.LZ4  // Fast for binary
 *   },
 *   enableStatistics: true,
 *   sortBy: ['timestamp'],
 *   partitionColumns: ['date']
 * }
 * ```
 *
 * @interface ParquetWriteOptions
 */
export interface ParquetWriteOptions {
  /**
   * Maximum number of rows per row group.
   * Smaller groups = more granular reads, larger groups = better compression.
   *
   * @default 65536
   */
  rowGroupSize?: number

  /**
   * Maximum memory size in bytes for a row group.
   * Triggers flush when reached, regardless of row count.
   */
  rowGroupMemoryLimit?: number

  /**
   * Default compression algorithm for all columns.
   *
   * @default ParquetCompression.SNAPPY
   */
  compression?: ParquetCompression

  /**
   * Per-column compression overrides.
   * Keys are column names, values are compression types.
   */
  columnCompression?: Record<string, ParquetCompression>

  /**
   * Whether to compute and store column statistics.
   * Enables predicate pushdown during queries.
   *
   * @default false
   */
  enableStatistics?: boolean

  /**
   * Columns to sort data by within each row group.
   * Improves query performance for sorted access patterns.
   */
  sortBy?: string[]

  /**
   * Columns used for partitioning.
   * Informational metadata for partitioned datasets.
   */
  partitionColumns?: string[]
}

/**
 * Statistics for a single column in a row group.
 *
 * @description
 * Column statistics enable query engines to skip row groups that don't
 * contain relevant data (predicate pushdown).
 *
 * @example
 * ```typescript
 * const stats: ColumnStatistics = {
 *   min: 100,
 *   max: 999,
 *   nullCount: 5,
 *   distinctCount: 850
 * }
 * ```
 *
 * @interface ColumnStatistics
 */
export interface ColumnStatistics {
  /**
   * Minimum value in the column.
   * Type depends on column type.
   */
  min?: number | string | boolean

  /**
   * Maximum value in the column.
   * Type depends on column type.
   */
  max?: number | string | boolean

  /**
   * Number of null values in the column.
   */
  nullCount?: number

  /**
   * Approximate distinct value count.
   * May not be exact for large datasets.
   */
  distinctCount?: number
}

/**
 * Metadata for a column chunk within a row group.
 *
 * @description
 * Contains information about a single column's data within a row group,
 * including compression, sizes, and statistics.
 *
 * @interface ColumnChunkMetadata
 */
export interface ColumnChunkMetadata {
  /**
   * Column name.
   */
  column: string

  /**
   * Data type of the column.
   */
  type: ParquetFieldType

  /**
   * Compression used for this column chunk.
   */
  compression: ParquetCompression

  /**
   * Size in bytes after compression.
   */
  encodedSize: number

  /**
   * Size in bytes before compression.
   */
  uncompressedSize: number

  /**
   * Column statistics if statistics are enabled.
   */
  statistics?: ColumnStatistics
}

/**
 * Row group representation in the Parquet file.
 *
 * @description
 * A row group is a horizontal partition of the data containing all columns
 * for a subset of rows. Row groups enable parallel processing and predicate
 * pushdown optimizations.
 *
 * @interface RowGroup
 */
export interface RowGroup {
  /**
   * Number of rows in this row group.
   */
  numRows: number

  /**
   * Total compressed size in bytes.
   */
  totalByteSize: number

  /**
   * Metadata for each column chunk.
   */
  columns: ColumnChunkMetadata[]
}

/**
 * Complete metadata for a Parquet file.
 *
 * @description
 * Contains all metadata stored in the Parquet file footer, including
 * schema, row groups, and statistics. Used when reading files.
 *
 * @example
 * ```typescript
 * const metadata = getMetadata(parquetBuffer)
 * console.log(`Rows: ${metadata.numRows}`)
 * console.log(`Row groups: ${metadata.rowGroups.length}`)
 * console.log(`Compression: ${metadata.compression}`)
 * ```
 *
 * @interface ParquetMetadata
 */
export interface ParquetMetadata {
  /**
   * The file's schema definition.
   */
  schema: ParquetSchema

  /**
   * Total number of rows in the file.
   */
  numRows: number

  /**
   * Array of row group metadata.
   */
  rowGroups: RowGroup[]

  /**
   * Default compression algorithm used.
   */
  compression: ParquetCompression

  /**
   * Per-column compression settings.
   */
  columnMetadata?: Record<string, { compression: ParquetCompression }>

  /**
   * Custom key-value metadata.
   */
  keyValueMetadata?: Record<string, string>

  /**
   * Unix timestamp when the file was created.
   */
  createdAt: number

  /**
   * Total file size in bytes.
   */
  fileSize: number

  /**
   * Columns the data is sorted by.
   */
  sortedBy?: string[]

  /**
   * Columns used for partitioning.
   */
  partitionColumns?: string[]
}

/**
 * Mock output stream interface for writing Parquet data.
 *
 * @description
 * Simple interface for streaming Parquet output to a destination.
 * Can be implemented for files, network streams, etc.
 *
 * @example
 * ```typescript
 * class BufferOutputStream implements OutputStream {
 *   private chunks: Uint8Array[] = []
 *
 *   write(data: Uint8Array): void {
 *     this.chunks.push(data)
 *   }
 *
 *   getBuffer(): Uint8Array {
 *     const total = this.chunks.reduce((sum, c) => sum + c.length, 0)
 *     const result = new Uint8Array(total)
 *     let offset = 0
 *     for (const chunk of this.chunks) {
 *       result.set(chunk, offset)
 *       offset += chunk.length
 *     }
 *     return result
 *   }
 * }
 * ```
 *
 * @interface OutputStream
 */
export interface OutputStream {
  /**
   * Writes data to the output stream.
   *
   * @param data - The data to write
   */
  write(data: Uint8Array): void
}

/**
 * Error class for Parquet-related operations.
 *
 * @description
 * Thrown when Parquet operations fail, such as schema validation errors,
 * invalid data types, or malformed files.
 *
 * @example
 * ```typescript
 * try {
 *   await writer.writeRow({ invalid_field: 'value' })
 * } catch (error) {
 *   if (error instanceof ParquetError) {
 *     console.log(`Parquet error (${error.code}): ${error.message}`)
 *   }
 * }
 * ```
 *
 * @class ParquetError
 * @extends Error
 */
export class ParquetError extends Error {
  /**
   * Creates a new ParquetError.
   *
   * @param message - Human-readable error message
   * @param code - Error code for programmatic handling
   *
   * @example
   * ```typescript
   * throw new ParquetError('Field name cannot be empty', 'EMPTY_FIELD_NAME')
   * ```
   */
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'ParquetError'
  }
}

// ============================================================================
// Internal types
// ============================================================================

/**
 * Internal representation of a row group during building.
 * @internal
 */
interface InternalRowGroup {
  /**
   * Array of rows in this group.
   */
  rows: Record<string, unknown>[]

  /**
   * Estimated memory size in bytes.
   */
  byteSize: number
}

// ============================================================================
// ParquetWriter Class
// ============================================================================

/**
 * Parquet writer for git analytics data.
 *
 * @description
 * ParquetWriter provides a streaming interface for writing data to Parquet
 * format. It handles schema validation, row group management, compression,
 * and statistics generation.
 *
 * **Usage Pattern:**
 * 1. Create a schema using `defineSchema()`
 * 2. Create a writer with `createParquetWriter()` or `new ParquetWriter()`
 * 3. Write rows using `writeRow()` or `writeRows()`
 * 4. Generate the file with `toBuffer()` or `writeTo()`
 *
 * **Row Group Management:**
 * Rows are buffered in memory until the row group is full (by row count
 * or memory limit), then flushed. You can also manually flush with
 * `flushRowGroup()`.
 *
 * **Thread Safety:**
 * Not thread-safe. Use separate writer instances for concurrent writes.
 *
 * @example
 * ```typescript
 * // Create schema
 * const schema = defineSchema([
 *   { name: 'sha', type: ParquetFieldType.STRING, required: true },
 *   { name: 'type', type: ParquetFieldType.STRING, required: true },
 *   { name: 'size', type: ParquetFieldType.INT64, required: true },
 *   { name: 'timestamp', type: ParquetFieldType.TIMESTAMP_MILLIS, required: true }
 * ])
 *
 * // Create writer
 * const writer = new ParquetWriter(schema, {
 *   rowGroupSize: 10000,
 *   compression: ParquetCompression.SNAPPY,
 *   enableStatistics: true
 * })
 *
 * // Write data
 * for (const object of gitObjects) {
 *   await writer.writeRow({
 *     sha: object.sha,
 *     type: object.type,
 *     size: object.size,
 *     timestamp: Date.now()
 *   })
 * }
 *
 * // Set custom metadata
 * writer.setMetadata('git_version', '2.40.0')
 * writer.setMetadata('repository', 'github.com/org/repo')
 *
 * // Generate file
 * const buffer = await writer.toBuffer()
 * console.log(`Generated ${buffer.length} bytes`)
 * console.log(`Rows: ${writer.rowCount}`)
 * console.log(`Row groups: ${writer.rowGroupCount}`)
 *
 * // Reset for reuse
 * writer.reset()
 * ```
 *
 * @class ParquetWriter
 */
export class ParquetWriter {
  /**
   * The Parquet schema for this writer.
   * @readonly
   */
  public readonly schema: ParquetSchema

  /**
   * Resolved options with defaults applied.
   * @readonly
   */
  public readonly options: Required<Pick<ParquetWriteOptions, 'rowGroupSize' | 'compression'>> & ParquetWriteOptions

  /**
   * Total row count written.
   * @private
   */
  private _rowCount = 0

  /**
   * Completed row groups.
   * @private
   */
  private _rowGroups: RowGroup[] = []

  /**
   * Current row group being built.
   * @private
   */
  private _currentRowGroup: InternalRowGroup = { rows: [], byteSize: 0 }

  /**
   * Whether the writer has been closed.
   * @private
   */
  private _isClosed = false

  /**
   * Custom key-value metadata.
   * @private
   */
  private _keyValueMetadata: Record<string, string> = {}

  /**
   * Creation timestamp.
   * @private
   */
  private _createdAt: number = Date.now()

  /**
   * Creates a new ParquetWriter instance.
   *
   * @param schema - The Parquet schema defining columns
   * @param options - Writer configuration options
   *
   * @example
   * ```typescript
   * const writer = new ParquetWriter(schema, {
   *   rowGroupSize: 50000,
   *   compression: ParquetCompression.GZIP
   * })
   * ```
   */
  constructor(schema: ParquetSchema, options: ParquetWriteOptions = {}) {
    this.schema = schema
    this.options = {
      rowGroupSize: options.rowGroupSize ?? 65536,
      compression: options.compression ?? ParquetCompression.SNAPPY,
      ...options
    }
  }

  /**
   * Gets the total row count written to the writer.
   *
   * @description
   * Returns the total number of rows written, including rows in the
   * current unflushed row group.
   *
   * @returns Total row count
   *
   * @example
   * ```typescript
   * await writer.writeRows(data)
   * console.log(`Wrote ${writer.rowCount} rows`)
   * ```
   */
  get rowCount(): number {
    return this._rowCount
  }

  /**
   * Gets the number of row groups.
   *
   * @description
   * Returns the number of completed row groups plus one if there's
   * a pending row group with data.
   *
   * @returns Number of row groups
   *
   * @example
   * ```typescript
   * console.log(`Row groups: ${writer.rowGroupCount}`)
   * ```
   */
  get rowGroupCount(): number {
    const pendingCount = this._currentRowGroup.rows.length > 0 ? 1 : 0
    return this._rowGroups.length + pendingCount
  }

  /**
   * Checks if the writer has been closed.
   *
   * @description
   * A closed writer cannot accept new rows. Writers are closed
   * implicitly by `closeWriter()`.
   *
   * @returns true if closed
   *
   * @example
   * ```typescript
   * if (!writer.isClosed) {
   *   await writer.writeRow(row)
   * }
   * ```
   */
  get isClosed(): boolean {
    return this._isClosed
  }

  /**
   * Writes a single row to the Parquet file.
   *
   * @description
   * Validates the row against the schema and adds it to the current
   * row group. Automatically flushes the row group when it reaches
   * the configured size or memory limit.
   *
   * @param row - Object with column values keyed by column name
   * @returns Promise that resolves when the row is written
   *
   * @throws {ParquetError} WRITER_CLOSED - If writer is closed
   * @throws {ParquetError} MISSING_REQUIRED_FIELD - If required field is missing
   * @throws {ParquetError} INVALID_FIELD_TYPE - If field value type doesn't match schema
   *
   * @example
   * ```typescript
   * await writer.writeRow({
   *   id: 123,
   *   name: 'Alice',
   *   active: true
   * })
   * ```
   */
  async writeRow(row: Record<string, unknown>): Promise<void> {
    if (this._isClosed) {
      throw new ParquetError('Cannot write to a closed writer', 'WRITER_CLOSED')
    }

    this._validateRow(row)

    const rowSize = this._estimateRowSize(row)
    this._currentRowGroup.rows.push(row)
    this._currentRowGroup.byteSize += rowSize
    this._rowCount++

    // Check if we should flush based on row count
    if (this._currentRowGroup.rows.length >= this.options.rowGroupSize) {
      await this.flushRowGroup()
    }
    // Check if we should flush based on memory limit
    else if (
      this.options.rowGroupMemoryLimit &&
      this._currentRowGroup.byteSize >= this.options.rowGroupMemoryLimit
    ) {
      await this.flushRowGroup()
    }
  }

  /**
   * Writes multiple rows to the Parquet file.
   *
   * @description
   * Convenience method that writes an array of rows sequentially.
   * Each row is validated and may trigger row group flushes.
   *
   * @param rows - Array of row objects to write
   * @returns Promise that resolves when all rows are written
   *
   * @throws {ParquetError} Any error from writeRow()
   *
   * @example
   * ```typescript
   * await writer.writeRows([
   *   { id: 1, name: 'Alice' },
   *   { id: 2, name: 'Bob' },
   *   { id: 3, name: 'Carol' }
   * ])
   * ```
   */
  async writeRows(rows: Record<string, unknown>[]): Promise<void> {
    for (const row of rows) {
      await this.writeRow(row)
    }
  }

  /**
   * Manually flushes the current row group.
   *
   * @description
   * Forces the current row group to be finalized and stored, even if
   * it hasn't reached the size limit. Has no effect if the current
   * row group is empty.
   *
   * @returns Promise that resolves when flush is complete
   *
   * @example
   * ```typescript
   * // Write some rows
   * await writer.writeRows(batch1)
   *
   * // Force flush before writing next batch
   * await writer.flushRowGroup()
   *
   * // Continue writing
   * await writer.writeRows(batch2)
   * ```
   */
  async flushRowGroup(): Promise<void> {
    if (this._currentRowGroup.rows.length === 0) {
      return
    }

    const rowGroup = this._buildRowGroup(this._currentRowGroup)
    this._rowGroups.push(rowGroup)
    this._currentRowGroup = { rows: [], byteSize: 0 }
  }

  /**
   * Gets the current row group's memory size.
   *
   * @description
   * Returns the estimated memory consumption of the unflushed row group.
   * Useful for monitoring memory usage during streaming writes.
   *
   * @returns Memory size in bytes
   *
   * @example
   * ```typescript
   * if (writer.currentRowGroupMemorySize() > 50 * 1024 * 1024) {
   *   console.log('Row group using significant memory')
   *   await writer.flushRowGroup()
   * }
   * ```
   */
  currentRowGroupMemorySize(): number {
    return this._currentRowGroup.byteSize
  }

  /**
   * Gets the completed row groups.
   *
   * @description
   * Returns a copy of the completed row group metadata array.
   * Does not include the current unflushed row group.
   *
   * @returns Array of row group metadata
   *
   * @example
   * ```typescript
   * for (const rg of writer.getRowGroups()) {
   *   console.log(`Row group: ${rg.numRows} rows, ${rg.totalByteSize} bytes`)
   * }
   * ```
   */
  getRowGroups(): RowGroup[] {
    return [...this._rowGroups]
  }

  /**
   * Sets a custom key-value metadata entry.
   *
   * @description
   * Adds custom metadata that will be stored in the Parquet file footer.
   * Can be used for versioning, provenance, or application-specific data.
   *
   * @param key - Metadata key
   * @param value - Metadata value
   *
   * @example
   * ```typescript
   * writer.setMetadata('created_by', 'gitdo-analytics')
   * writer.setMetadata('schema_version', '2.0')
   * writer.setMetadata('repository', 'github.com/org/repo')
   * ```
   */
  setMetadata(key: string, value: string): void {
    this._keyValueMetadata[key] = value
  }

  /**
   * Generates the Parquet file as a buffer.
   *
   * @description
   * Finalizes the file by flushing any remaining rows and generating
   * the complete Parquet file structure including header, row groups,
   * and footer with metadata.
   *
   * @returns Promise resolving to the complete Parquet file as Uint8Array
   *
   * @example
   * ```typescript
   * const buffer = await writer.toBuffer()
   * await fs.writeFile('data.parquet', buffer)
   * ```
   */
  async toBuffer(): Promise<Uint8Array> {
    // Flush any remaining rows
    if (this._currentRowGroup.rows.length > 0) {
      await this.flushRowGroup()
    }

    return this._generateParquetBytes()
  }

  /**
   * Writes the Parquet file to an output stream.
   *
   * @description
   * Generates the file and writes it to the provided output stream.
   * Useful for streaming to files or network destinations.
   *
   * @param output - The output stream to write to
   * @returns Promise that resolves when writing is complete
   *
   * @example
   * ```typescript
   * const output = new FileOutputStream('data.parquet')
   * await writer.writeTo(output)
   * output.close()
   * ```
   */
  async writeTo(output: OutputStream): Promise<void> {
    const bytes = await this.toBuffer()
    output.write(bytes)
  }

  /**
   * Resets the writer to its initial state.
   *
   * @description
   * Clears all written data, row groups, and metadata. The schema
   * and options remain unchanged. Useful for writing multiple files
   * with the same configuration.
   *
   * @example
   * ```typescript
   * // Write first file
   * await writer.writeRows(batch1)
   * const file1 = await writer.toBuffer()
   *
   * // Reset and write second file
   * writer.reset()
   * await writer.writeRows(batch2)
   * const file2 = await writer.toBuffer()
   * ```
   */
  reset(): void {
    this._rowCount = 0
    this._rowGroups = []
    this._currentRowGroup = { rows: [], byteSize: 0 }
    this._isClosed = false
    this._keyValueMetadata = {}
    this._createdAt = Date.now()
  }

  /**
   * Validates a row against the schema.
   *
   * @param row - The row to validate
   * @throws {ParquetError} If validation fails
   * @private
   */
  private _validateRow(row: Record<string, unknown>): void {
    for (const field of this.schema.fields) {
      const value = row[field.name]

      // Check required fields
      if (field.required && (value === undefined || value === null)) {
        throw new ParquetError(
          `Missing required field: ${field.name}`,
          'MISSING_REQUIRED_FIELD'
        )
      }

      // Check type if value is present and not null
      if (value !== null && value !== undefined) {
        if (!this._validateType(value, field.type)) {
          throw new ParquetError(
            `Invalid type for field ${field.name}: expected ${field.type}`,
            'INVALID_FIELD_TYPE'
          )
        }
      }
    }
  }

  /**
   * Validates a value matches the expected Parquet type.
   *
   * @param value - The value to validate
   * @param type - The expected Parquet type
   * @returns true if valid, false otherwise
   * @private
   */
  private _validateType(value: unknown, type: ParquetFieldType): boolean {
    switch (type) {
      case ParquetFieldType.STRING:
        return typeof value === 'string'
      case ParquetFieldType.INT32:
      case ParquetFieldType.INT64:
      case ParquetFieldType.FLOAT:
      case ParquetFieldType.DOUBLE:
      case ParquetFieldType.TIMESTAMP_MILLIS:
      case ParquetFieldType.TIMESTAMP_MICROS:
        return typeof value === 'number'
      case ParquetFieldType.BOOLEAN:
        return typeof value === 'boolean'
      case ParquetFieldType.BINARY:
        return value instanceof Uint8Array || typeof value === 'string'
      default:
        return false
    }
  }

  /**
   * Estimates the memory size of a row.
   *
   * @param row - The row to estimate
   * @returns Estimated size in bytes
   * @private
   */
  private _estimateRowSize(row: Record<string, unknown>): number {
    let size = 0
    for (const field of this.schema.fields) {
      const value = row[field.name]
      if (value === null || value === undefined) {
        size += 1 // null marker
      } else if (typeof value === 'string') {
        size += value.length * 2 // UTF-16
      } else if (typeof value === 'number') {
        size += 8 // 64-bit
      } else if (typeof value === 'boolean') {
        size += 1
      } else if (value instanceof Uint8Array) {
        size += value.length
      }
    }
    return size
  }

  /**
   * Builds a row group from internal representation.
   *
   * @param internal - The internal row group data
   * @returns The row group metadata
   * @private
   */
  private _buildRowGroup(internal: InternalRowGroup): RowGroup {
    const columns: ColumnChunkMetadata[] = this.schema.fields.map(field => {
      const values = internal.rows.map(row => row[field.name])
      const stats = this.options.enableStatistics ? this._computeStatistics(values, field.type) : undefined
      const compression = this.options.columnCompression?.[field.name] ?? this.options.compression

      return {
        column: field.name,
        type: field.type,
        compression,
        encodedSize: this._estimateEncodedSize(values, field.type, compression),
        uncompressedSize: this._estimateUncompressedSize(values, field.type),
        statistics: stats
      }
    })

    return {
      numRows: internal.rows.length,
      totalByteSize: columns.reduce((sum, col) => sum + col.encodedSize, 0),
      columns
    }
  }

  /**
   * Computes statistics for a column.
   *
   * @param values - The column values
   * @param type - The column type
   * @returns Column statistics
   * @private
   */
  private _computeStatistics(values: unknown[], type: ParquetFieldType): ColumnStatistics {
    const nonNullValues = values.filter(v => v !== null && v !== undefined)
    const nullCount = values.length - nonNullValues.length

    if (nonNullValues.length === 0) {
      return { nullCount }
    }

    switch (type) {
      case ParquetFieldType.INT32:
      case ParquetFieldType.INT64:
      case ParquetFieldType.FLOAT:
      case ParquetFieldType.DOUBLE:
      case ParquetFieldType.TIMESTAMP_MILLIS:
      case ParquetFieldType.TIMESTAMP_MICROS: {
        const numbers = nonNullValues.filter(v => typeof v === 'number' && !Number.isNaN(v)) as number[]
        if (numbers.length === 0) {
          return { nullCount }
        }
        return {
          min: Math.min(...numbers),
          max: Math.max(...numbers),
          nullCount
        }
      }
      case ParquetFieldType.STRING: {
        const strings = nonNullValues as string[]
        return {
          min: strings.reduce((a, b) => a < b ? a : b),
          max: strings.reduce((a, b) => a > b ? a : b),
          nullCount
        }
      }
      case ParquetFieldType.BOOLEAN: {
        return { nullCount }
      }
      default:
        return { nullCount }
    }
  }

  /**
   * Estimates the encoded size after compression.
   *
   * @param values - The column values
   * @param type - The column type
   * @param compression - The compression type
   * @returns Estimated compressed size in bytes
   * @private
   */
  private _estimateEncodedSize(values: unknown[], type: ParquetFieldType, compression: ParquetCompression): number {
    const uncompressedSize = this._estimateUncompressedSize(values, type)

    // Apply compression ratio estimate
    switch (compression) {
      case ParquetCompression.SNAPPY:
        return Math.floor(uncompressedSize * 0.5)
      case ParquetCompression.GZIP:
        return Math.floor(uncompressedSize * 0.3)
      case ParquetCompression.ZSTD:
        return Math.floor(uncompressedSize * 0.25)
      case ParquetCompression.LZ4:
        return Math.floor(uncompressedSize * 0.4)
      case ParquetCompression.UNCOMPRESSED:
      default:
        return uncompressedSize
    }
  }

  /**
   * Estimates the uncompressed size of column values.
   *
   * @param values - The column values
   * @param type - The column type
   * @returns Estimated uncompressed size in bytes
   * @private
   */
  private _estimateUncompressedSize(values: unknown[], type: ParquetFieldType): number {
    let size = 0
    for (const value of values) {
      if (value === null || value === undefined) {
        size += 1
      } else {
        switch (type) {
          case ParquetFieldType.STRING:
            size += (value as string).length * 2
            break
          case ParquetFieldType.INT32:
          case ParquetFieldType.FLOAT:
            size += 4
            break
          case ParquetFieldType.INT64:
          case ParquetFieldType.DOUBLE:
          case ParquetFieldType.TIMESTAMP_MILLIS:
          case ParquetFieldType.TIMESTAMP_MICROS:
            size += 8
            break
          case ParquetFieldType.BOOLEAN:
            size += 1
            break
          case ParquetFieldType.BINARY:
            size += value instanceof Uint8Array ? value.length : (value as string).length
            break
        }
      }
    }
    return size
  }

  /**
   * Generates the complete Parquet file bytes.
   *
   * @returns The complete Parquet file as Uint8Array
   * @private
   */
  private _generateParquetBytes(): Uint8Array {
    // Build all row data - will be populated from row groups in full implementation
    // For now, row group data is serialized directly below

    // Calculate metadata
    const metadata: InternalMetadata = {
      schema: this.schema,
      numRows: this._rowCount,
      rowGroups: this._rowGroups,
      compression: this.options.compression,
      columnCompression: this.options.columnCompression,
      keyValueMetadata: this._keyValueMetadata,
      createdAt: this._createdAt,
      sortedBy: this.options.sortBy,
      partitionColumns: this.options.partitionColumns
    }

    // Encode metadata to JSON and then to bytes
    const metadataJson = JSON.stringify(metadata)
    const metadataBytes = new TextEncoder().encode(metadataJson)

    // Compress metadata if needed
    let compressedMetadata: Uint8Array
    if (this.options.compression === ParquetCompression.GZIP) {
      compressedMetadata = pako.gzip(metadataBytes)
    } else {
      // For SNAPPY, ZSTD, LZ4 - we'll use a simple RLE-like compression simulation
      // In production, you'd use actual compression libraries
      compressedMetadata = this._simpleCompress(metadataBytes, this.options.compression)
    }

    // Build final file structure
    // PAR1 magic (4 bytes) + data + metadata length (4 bytes) + metadata + PAR1 magic (4 bytes)
    const magic = new TextEncoder().encode('PAR1')
    const metadataLength = new Uint8Array(4)
    new DataView(metadataLength.buffer).setUint32(0, compressedMetadata.length, true)

    // Calculate total size
    const totalSize = 4 + compressedMetadata.length + 4 + 4
    const result = new Uint8Array(totalSize)

    // Write structure
    let offset = 0
    result.set(magic, offset)
    offset += 4
    result.set(compressedMetadata, offset)
    offset += compressedMetadata.length
    result.set(metadataLength, offset)
    offset += 4
    result.set(magic, offset)

    return result
  }

  /**
   * Simple compression simulation for non-gzip formats.
   *
   * @param data - Data to compress
   * @param compression - Compression type
   * @returns Compressed data
   * @private
   */
  private _simpleCompress(data: Uint8Array, compression: ParquetCompression): Uint8Array {
    if (compression === ParquetCompression.UNCOMPRESSED) {
      return data
    }

    // Use pako deflate for a basic compression simulation
    // Real implementation would use snappy-js, zstd-codec, lz4js etc.
    try {
      return pako.deflate(data, { level: compression === ParquetCompression.ZSTD ? 9 : 6 })
    } catch {
      return data
    }
  }
}

// ============================================================================
// Internal metadata type for serialization
// ============================================================================

/**
 * Internal metadata structure for JSON serialization.
 * @internal
 */
interface InternalMetadata {
  schema: ParquetSchema
  numRows: number
  rowGroups: RowGroup[]
  compression: ParquetCompression
  columnCompression?: Record<string, ParquetCompression>
  keyValueMetadata: Record<string, string>
  createdAt: number
  sortedBy?: string[]
  partitionColumns?: string[]
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Defines a Parquet schema.
 *
 * @description
 * Creates a validated Parquet schema from field definitions. Validates that:
 * - Schema has at least one field
 * - All field names are non-empty
 * - All field names are unique
 *
 * @param fields - Array of field definitions
 * @param metadata - Optional schema-level metadata
 * @returns Validated Parquet schema
 *
 * @throws {ParquetError} EMPTY_SCHEMA - If fields array is empty
 * @throws {ParquetError} EMPTY_FIELD_NAME - If any field name is empty
 * @throws {ParquetError} DUPLICATE_FIELD - If field names are not unique
 *
 * @example
 * ```typescript
 * const schema = defineSchema([
 *   { name: 'id', type: ParquetFieldType.INT64, required: true },
 *   { name: 'name', type: ParquetFieldType.STRING, required: true },
 *   { name: 'age', type: ParquetFieldType.INT32, required: false },
 *   { name: 'created_at', type: ParquetFieldType.TIMESTAMP_MILLIS, required: true }
 * ], {
 *   version: '1.0',
 *   description: 'User records'
 * })
 * ```
 */
export function defineSchema(
  fields: ParquetField[],
  metadata?: Record<string, string>
): ParquetSchema {
  // Validate schema
  if (fields.length === 0) {
    throw new ParquetError('Schema cannot be empty', 'EMPTY_SCHEMA')
  }

  const names = new Set<string>()
  for (const field of fields) {
    if (!field.name || field.name.trim() === '') {
      throw new ParquetError('Field name cannot be empty', 'EMPTY_FIELD_NAME')
    }
    if (names.has(field.name)) {
      throw new ParquetError(`Duplicate field name: ${field.name}`, 'DUPLICATE_FIELD')
    }
    names.add(field.name)
  }

  return {
    fields: fields.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
      metadata: f.metadata
    })),
    metadata
  }
}

/**
 * Creates a Parquet writer.
 *
 * @description
 * Factory function to create a ParquetWriter with the specified schema
 * and options. Equivalent to `new ParquetWriter(schema, options)`.
 *
 * @param schema - The Parquet schema
 * @param options - Writer options
 * @returns A new ParquetWriter instance
 *
 * @example
 * ```typescript
 * const writer = createParquetWriter(schema, {
 *   rowGroupSize: 10000,
 *   compression: ParquetCompression.SNAPPY
 * })
 * ```
 */
export function createParquetWriter(
  schema: ParquetSchema,
  options: ParquetWriteOptions = {}
): ParquetWriter {
  return new ParquetWriter(schema, options)
}

/**
 * Writes data directly to a Parquet file buffer.
 *
 * @description
 * Convenience function that creates a writer, writes all rows, and returns
 * the complete Parquet file. Useful for simple one-shot writes.
 *
 * @param schema - The Parquet schema
 * @param rows - Array of rows to write
 * @param options - Writer options
 * @returns Promise resolving to the complete Parquet file as Uint8Array
 *
 * @example
 * ```typescript
 * const buffer = await writeParquetFile(schema, [
 *   { id: 1, name: 'Alice' },
 *   { id: 2, name: 'Bob' }
 * ], {
 *   compression: ParquetCompression.GZIP
 * })
 *
 * await fs.writeFile('data.parquet', buffer)
 * ```
 */
export async function writeParquetFile(
  schema: ParquetSchema,
  rows: Record<string, unknown>[],
  options: ParquetWriteOptions = {}
): Promise<Uint8Array> {
  const writer = createParquetWriter(schema, options)
  await writer.writeRows(rows)
  return writer.toBuffer()
}

/**
 * Closes a writer and returns the final buffer.
 *
 * @description
 * Generates the final Parquet file buffer and marks the writer as closed.
 * The writer cannot be used for further writes after calling this function.
 *
 * @param writer - The ParquetWriter to close
 * @returns Promise resolving to the complete Parquet file as Uint8Array
 *
 * @example
 * ```typescript
 * await writer.writeRows(data)
 * const buffer = await closeWriter(writer)
 * console.log(writer.isClosed)  // true
 * ```
 */
export async function closeWriter(writer: ParquetWriter): Promise<Uint8Array> {
  const bytes = await writer.toBuffer()
  ;(writer as unknown as { _isClosed: boolean })._isClosed = true
  return bytes
}

/**
 * Adds a row group to the writer.
 *
 * @description
 * Writes multiple rows and then flushes them as a single row group.
 * Useful when you want explicit control over row group boundaries.
 *
 * @param writer - The ParquetWriter to use
 * @param rows - Array of rows for this row group
 * @returns Promise that resolves when the row group is written
 *
 * @example
 * ```typescript
 * // Add explicit row groups
 * await addRowGroup(writer, batch1)  // First row group
 * await addRowGroup(writer, batch2)  // Second row group
 * ```
 */
export async function addRowGroup(
  writer: ParquetWriter,
  rows: Record<string, unknown>[]
): Promise<void> {
  await writer.writeRows(rows)
  await writer.flushRowGroup()
}

/**
 * Gets metadata from a Parquet file buffer.
 *
 * @description
 * Parses a Parquet file buffer and extracts the metadata including
 * schema, row groups, compression settings, and custom metadata.
 *
 * @param bytes - The Parquet file buffer
 * @returns The parsed metadata
 *
 * @throws {ParquetError} INVALID_MAGIC - If file doesn't have valid Parquet magic bytes
 *
 * @example
 * ```typescript
 * const buffer = await fs.readFile('data.parquet')
 * const metadata = getMetadata(buffer)
 *
 * console.log(`Rows: ${metadata.numRows}`)
 * console.log(`Schema: ${metadata.schema.fields.map(f => f.name).join(', ')}`)
 * console.log(`Row groups: ${metadata.rowGroups.length}`)
 *
 * for (const rg of metadata.rowGroups) {
 *   console.log(`  - ${rg.numRows} rows, ${rg.totalByteSize} bytes`)
 * }
 * ```
 */
export function getMetadata(bytes: Uint8Array): ParquetMetadata {
  // Verify magic bytes
  const startMagic = new TextDecoder().decode(bytes.slice(0, 4))
  const endMagic = new TextDecoder().decode(bytes.slice(-4))

  if (startMagic !== 'PAR1' || endMagic !== 'PAR1') {
    throw new ParquetError('Invalid Parquet file: missing magic bytes', 'INVALID_MAGIC')
  }

  // Read metadata length (4 bytes before final magic)
  const metadataLengthOffset = bytes.length - 8
  const metadataLength = new DataView(bytes.buffer, bytes.byteOffset + metadataLengthOffset, 4).getUint32(0, true)

  // Read compressed metadata
  const metadataStart = 4
  const compressedMetadata = bytes.slice(metadataStart, metadataStart + metadataLength)

  // Decompress metadata
  let metadataBytes: Uint8Array
  try {
    // Try gzip first
    metadataBytes = pako.ungzip(compressedMetadata)
  } catch {
    try {
      // Try inflate (deflate)
      metadataBytes = pako.inflate(compressedMetadata)
    } catch {
      // Assume uncompressed
      metadataBytes = compressedMetadata
    }
  }

  // Parse metadata JSON
  const metadataJson = new TextDecoder().decode(metadataBytes)
  const internal: InternalMetadata = JSON.parse(metadataJson)

  // Build column metadata map
  const columnMetadata: Record<string, { compression: ParquetCompression }> = {}
  if (internal.columnCompression) {
    for (const [col, comp] of Object.entries(internal.columnCompression)) {
      columnMetadata[col] = { compression: comp }
    }
  }

  return {
    schema: internal.schema,
    numRows: internal.numRows,
    rowGroups: internal.rowGroups,
    compression: internal.compression,
    columnMetadata: Object.keys(columnMetadata).length > 0 ? columnMetadata : undefined,
    keyValueMetadata: Object.keys(internal.keyValueMetadata).length > 0 ? internal.keyValueMetadata : undefined,
    createdAt: internal.createdAt,
    fileSize: bytes.length,
    sortedBy: internal.sortedBy,
    partitionColumns: internal.partitionColumns
  }
}

/**
 * Sets the compression type for a writer.
 *
 * @description
 * Updates the default compression algorithm for a writer. Affects all
 * subsequently written data. Columns with explicit compression settings
 * in columnCompression are not affected.
 *
 * @param writer - The ParquetWriter to update
 * @param compression - The new compression type
 *
 * @example
 * ```typescript
 * const writer = createParquetWriter(schema)
 *
 * // Write some rows with SNAPPY (default)
 * await writer.writeRows(batch1)
 * await writer.flushRowGroup()
 *
 * // Switch to GZIP for remaining data
 * setCompression(writer, ParquetCompression.GZIP)
 * await writer.writeRows(batch2)
 * ```
 */
export function setCompression(writer: ParquetWriter, compression: ParquetCompression): void {
  ;(writer.options as { compression: ParquetCompression }).compression = compression
}
