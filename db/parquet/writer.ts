/**
 * Parquet Writer for Vector Compaction
 *
 * Provides ParquetBuilder class for efficiently building Parquet files
 * from vector records. Designed for DO SQLite to R2 compaction workflows.
 *
 * Uses apache-arrow for schema/table building and parquet-wasm for
 * Parquet file generation with ZSTD compression.
 *
 * @module db/parquet/writer
 *
 * @example
 * ```typescript
 * import { ParquetBuilder } from 'dotdo/db/parquet/writer'
 * import { VECTOR_SCHEMA_1536 } from 'dotdo/db/parquet/schema'
 *
 * const builder = new ParquetBuilder({
 *   schema: VECTOR_SCHEMA_1536,
 *   compression: 'ZSTD',
 *   rowGroupSize: 2000,
 * })
 *
 * for (const vector of vectors) {
 *   builder.addRow({
 *     ns: 'tenant.do',
 *     type: 'Document',
 *     visibility: 'public',
 *     id: vector.id,
 *     embedding: vector.embedding,
 *     metadata: JSON.stringify(vector.metadata),
 *     created_at: vector.createdAt,
 *   })
 * }
 *
 * const parquetBytes = await builder.finish()
 * await r2.put('vectors/ns=tenant.do/dt=2026-01-09/vectors_123.parquet', parquetBytes)
 * ```
 */

import {
  Schema,
  tableFromArrays,
  tableToIPC,
  type Table as ArrowTable,
} from 'apache-arrow'

import type { VectorRecord, VectorSchemaOptions } from './schema'
import {
  createVectorSchema,
  validateVectorRecord,
  DEFAULT_EMBEDDING_DIMENSION,
  PARQUET_METADATA_KEYS,
  SCHEMA_VERSION,
} from './schema'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Compression codec for Parquet files
 */
export type ParquetCompression = 'ZSTD' | 'SNAPPY' | 'NONE'

/**
 * ZSTD compression level (1-22, default 3)
 */
export type ZstdLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22

/**
 * Parquet schema type (can be Arrow Schema or custom schema options)
 */
export type ParquetSchema = Schema | VectorSchemaOptions

/**
 * Configuration options for ParquetBuilder
 */
export interface ParquetBuilderOptions {
  /**
   * Arrow schema or schema options for vector records
   */
  schema: ParquetSchema

  /**
   * Compression codec to use
   * @default 'ZSTD'
   */
  compression?: ParquetCompression

  /**
   * ZSTD compression level (only used when compression is 'ZSTD')
   * @default 3
   */
  compressionLevel?: ZstdLevel

  /**
   * Number of rows per row group
   * Larger values = better compression, smaller values = better random access
   * @default 2000
   */
  rowGroupSize?: number

  /**
   * Maximum rows before auto-flushing to a row group
   * @default rowGroupSize
   */
  maxBufferSize?: number

  /**
   * Enable dictionary encoding for string columns
   * @default true
   */
  useDictionary?: boolean

  /**
   * Custom file metadata to include
   */
  metadata?: Record<string, string>
}

/**
 * Result from ParquetBuilder.finish()
 */
export interface ParquetWriteResult {
  /** Parquet file bytes */
  buffer: ArrayBuffer
  /** Number of rows written */
  rowCount: number
  /** Number of row groups */
  rowGroupCount: number
  /** Uncompressed size estimate (bytes) */
  uncompressedSize: number
  /** Compressed size (bytes) */
  compressedSize: number
  /** Compression ratio */
  compressionRatio: number
}

/**
 * Column buffers for building Arrow table
 */
interface ColumnBuffers {
  ns: string[]
  type: string[]
  visibility: (string | null)[]
  id: string[]
  embedding: Float32Array[]
  metadata: (string | null)[]
  created_at: bigint[]
}

// ============================================================================
// PARQUET-WASM TYPES (lazy loaded)
// ============================================================================

/**
 * parquet-wasm module interface (loaded dynamically)
 */
interface ParquetWasmModule {
  writeParquet: (table: unknown, properties: unknown) => Uint8Array
  Table: {
    fromIPCStream: (buffer: Uint8Array) => unknown
  }
  WriterPropertiesBuilder: new () => WriterPropertiesBuilder
  Compression: {
    UNCOMPRESSED: number
    SNAPPY: number
    ZSTD: number
  }
}

interface WriterPropertiesBuilder {
  setCompression(compression: number): this
  setCompressionLevel(level: number): this
  setDictionaryEnabled(enabled: boolean): this
  setMaxRowGroupSize(size: number): this
  setKeyValueMetadata(metadata: Map<string, string>): this
  build(): unknown
}

// ============================================================================
// WASM LOADING
// ============================================================================

let parquetWasm: ParquetWasmModule | null = null
let wasmInitPromise: Promise<ParquetWasmModule> | null = null

/**
 * Initialize parquet-wasm module
 * Caches the module after first load
 */
async function initParquetWasm(): Promise<ParquetWasmModule> {
  if (parquetWasm) {
    return parquetWasm
  }

  if (wasmInitPromise) {
    return wasmInitPromise
  }

  wasmInitPromise = (async () => {
    // Dynamic import to allow tree-shaking when not used
    const wasm = await import('parquet-wasm')
    // Initialize WASM (some builds require explicit init)
    if (typeof wasm.default === 'function') {
      await wasm.default()
    }
    parquetWasm = wasm as unknown as ParquetWasmModule
    return parquetWasm
  })()

  return wasmInitPromise
}

// ============================================================================
// PARQUET BUILDER CLASS
// ============================================================================

/**
 * ParquetBuilder constructs Parquet files from vector records
 *
 * Buffers rows in memory and converts to Parquet format on finish().
 * Designed for compaction workflows where vectors are read from SQLite
 * and written to R2 as Parquet files.
 *
 * @example Basic usage
 * ```typescript
 * const builder = new ParquetBuilder({
 *   schema: VECTOR_SCHEMA_1536,
 *   compression: 'ZSTD',
 *   rowGroupSize: 2000,
 * })
 *
 * builder.addRow({
 *   ns: 'payments.do',
 *   type: 'Invoice',
 *   visibility: 'org',
 *   id: 'inv_123',
 *   embedding: new Float32Array(1536),
 *   metadata: '{"amount": 100}',
 *   created_at: Date.now(),
 * })
 *
 * const result = await builder.finish()
 * console.log(`Wrote ${result.rowCount} rows, ${result.compressedSize} bytes`)
 * ```
 *
 * @example With custom metadata
 * ```typescript
 * const builder = new ParquetBuilder({
 *   schema: { dimension: 512 },
 *   compression: 'ZSTD',
 *   compressionLevel: 3,
 *   metadata: {
 *     'dotdo:embedding_model': 'voyage-3-lite',
 *     'dotdo:namespace': 'analytics.do',
 *   },
 * })
 * ```
 */
export class ParquetBuilder {
  private readonly schema: Schema
  private readonly compression: ParquetCompression
  private readonly compressionLevel: ZstdLevel
  private readonly rowGroupSize: number
  private readonly useDictionary: boolean
  private readonly customMetadata: Record<string, string>
  private readonly dimension: number

  private buffers: ColumnBuffers
  private rowCount: number = 0
  private finalized: boolean = false

  // Statistics for metadata
  private minTimestamp: number = Number.MAX_SAFE_INTEGER
  private maxTimestamp: number = 0

  /**
   * Create a new ParquetBuilder
   *
   * @param options - Builder configuration
   */
  constructor(options: ParquetBuilderOptions) {
    // Resolve schema
    this.schema = options.schema instanceof Schema
      ? options.schema
      : createVectorSchema(options.schema)

    this.compression = options.compression ?? 'ZSTD'
    this.compressionLevel = options.compressionLevel ?? 3
    this.rowGroupSize = options.rowGroupSize ?? 2000
    this.useDictionary = options.useDictionary ?? true
    this.customMetadata = options.metadata ?? {}

    // Get dimension from schema
    const embeddingField = this.schema.fields.find((f) => f.name === 'embedding')
    this.dimension = embeddingField?.type && 'listSize' in embeddingField.type
      ? (embeddingField.type as { listSize: number }).listSize
      : DEFAULT_EMBEDDING_DIMENSION

    this.buffers = this.createEmptyBuffers()
  }

  /**
   * Create empty column buffers
   */
  private createEmptyBuffers(): ColumnBuffers {
    return {
      ns: [],
      type: [],
      visibility: [],
      id: [],
      embedding: [],
      metadata: [],
      created_at: [],
    }
  }

  /**
   * Add a vector record to the builder
   *
   * @param row - Vector record to add
   * @throws Error if builder has been finalized
   */
  addRow(row: VectorRecord): void {
    if (this.finalized) {
      throw new Error('ParquetBuilder has been finalized, cannot add more rows')
    }

    // Validate the record
    validateVectorRecord(row, this.dimension)

    // Add to column buffers
    this.buffers.ns.push(row.ns)
    this.buffers.type.push(row.type)
    this.buffers.visibility.push(row.visibility)
    this.buffers.id.push(row.id)

    // Convert embedding to Float32Array if needed
    const embedding = row.embedding instanceof Float32Array
      ? row.embedding
      : new Float32Array(row.embedding)
    this.buffers.embedding.push(embedding)

    this.buffers.metadata.push(row.metadata)
    this.buffers.created_at.push(BigInt(row.created_at))

    // Update statistics
    if (row.created_at < this.minTimestamp) {
      this.minTimestamp = row.created_at
    }
    if (row.created_at > this.maxTimestamp) {
      this.maxTimestamp = row.created_at
    }

    this.rowCount++
  }

  /**
   * Add multiple vector records
   *
   * @param rows - Array of vector records
   */
  addRows(rows: VectorRecord[]): void {
    for (const row of rows) {
      this.addRow(row)
    }
  }

  /**
   * Get the current row count
   */
  getRowCount(): number {
    return this.rowCount
  }

  /**
   * Check if builder has any rows
   */
  isEmpty(): boolean {
    return this.rowCount === 0
  }

  /**
   * Build Arrow table from buffered data
   */
  private buildArrowTable(): ArrowTable {
    // Flatten embeddings into a single typed array for FixedSizeList
    const flatEmbeddings = new Float32Array(this.rowCount * this.dimension)
    for (let i = 0; i < this.rowCount; i++) {
      flatEmbeddings.set(this.buffers.embedding[i]!, i * this.dimension)
    }

    // Build table from arrays
    // Note: apache-arrow's tableFromArrays handles the schema inference
    return tableFromArrays({
      ns: this.buffers.ns,
      type: this.buffers.type,
      visibility: this.buffers.visibility,
      id: this.buffers.id,
      embedding: flatEmbeddings,
      metadata: this.buffers.metadata,
      created_at: this.buffers.created_at,
    })
  }

  /**
   * Finalize and generate Parquet file
   *
   * @returns Parquet write result with buffer and statistics
   * @throws Error if builder is empty
   */
  async finish(): Promise<ParquetWriteResult> {
    if (this.finalized) {
      throw new Error('ParquetBuilder has already been finalized')
    }

    if (this.rowCount === 0) {
      throw new Error('Cannot finalize empty ParquetBuilder')
    }

    this.finalized = true

    // Initialize parquet-wasm
    const wasm = await initParquetWasm()

    // Build Arrow table
    const arrowTable = this.buildArrowTable()

    // Convert to IPC stream format for parquet-wasm
    const ipcBuffer = tableToIPC(arrowTable, 'stream')

    // Create parquet-wasm table from IPC
    const wasmTable = wasm.Table.fromIPCStream(ipcBuffer)

    // Build writer properties
    const propsBuilder = new wasm.WriterPropertiesBuilder()
      .setDictionaryEnabled(this.useDictionary)
      .setMaxRowGroupSize(this.rowGroupSize)

    // Set compression
    switch (this.compression) {
      case 'ZSTD':
        propsBuilder.setCompression(wasm.Compression.ZSTD)
        propsBuilder.setCompressionLevel(this.compressionLevel)
        break
      case 'SNAPPY':
        propsBuilder.setCompression(wasm.Compression.SNAPPY)
        break
      case 'NONE':
        propsBuilder.setCompression(wasm.Compression.UNCOMPRESSED)
        break
    }

    // Build metadata
    const metadata = new Map<string, string>([
      [PARQUET_METADATA_KEYS.SCHEMA_VERSION, SCHEMA_VERSION],
      [PARQUET_METADATA_KEYS.VECTOR_COUNT, String(this.rowCount)],
      [PARQUET_METADATA_KEYS.MIN_TIMESTAMP, String(this.minTimestamp)],
      [PARQUET_METADATA_KEYS.MAX_TIMESTAMP, String(this.maxTimestamp)],
      ...Object.entries(this.customMetadata),
    ])
    propsBuilder.setKeyValueMetadata(metadata)

    const writerProps = propsBuilder.build()

    // Write Parquet file
    const parquetBytes = wasm.writeParquet(wasmTable, writerProps)

    // Calculate statistics
    const uncompressedSize = this.estimateUncompressedSize()
    const compressedSize = parquetBytes.byteLength

    return {
      buffer: parquetBytes.buffer as ArrayBuffer,
      rowCount: this.rowCount,
      rowGroupCount: Math.ceil(this.rowCount / this.rowGroupSize),
      uncompressedSize,
      compressedSize,
      compressionRatio: uncompressedSize / compressedSize,
    }
  }

  /**
   * Estimate uncompressed size for statistics
   */
  private estimateUncompressedSize(): number {
    // Estimate based on column sizes
    let size = 0

    // String columns (ns, type, visibility, id, metadata)
    for (const ns of this.buffers.ns) size += ns.length * 2
    for (const type of this.buffers.type) size += type.length * 2
    for (const vis of this.buffers.visibility) size += (vis?.length ?? 0) * 2
    for (const id of this.buffers.id) size += id.length * 2
    for (const meta of this.buffers.metadata) size += (meta?.length ?? 0) * 2

    // Embeddings (Float32 = 4 bytes)
    size += this.rowCount * this.dimension * 4

    // Timestamps (BigInt64 = 8 bytes)
    size += this.rowCount * 8

    return size
  }

  /**
   * Reset the builder for reuse
   */
  reset(): void {
    this.buffers = this.createEmptyBuffers()
    this.rowCount = 0
    this.finalized = false
    this.minTimestamp = Number.MAX_SAFE_INTEGER
    this.maxTimestamp = 0
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a Parquet file from vector records in one call
 *
 * @param records - Vector records to write
 * @param options - Builder options
 * @returns Parquet file bytes
 *
 * @example
 * ```typescript
 * const buffer = await writeVectorsToParquet(vectors, {
 *   schema: { dimension: 1536 },
 *   compression: 'ZSTD',
 * })
 * ```
 */
export async function writeVectorsToParquet(
  records: VectorRecord[],
  options: Omit<ParquetBuilderOptions, 'schema'> & {
    schema?: ParquetSchema
    dimension?: number
  } = {}
): Promise<ArrayBuffer> {
  const schema = options.schema ?? createVectorSchema({
    dimension: options.dimension ?? DEFAULT_EMBEDDING_DIMENSION,
  })

  const builder = new ParquetBuilder({
    ...options,
    schema,
  })

  builder.addRows(records)
  const result = await builder.finish()
  return result.buffer
}

/**
 * Generate R2 path for a vector Parquet file
 *
 * Uses Hive-style partitioning: vectors/ns={namespace}/dt={date}/vectors_{timestamp}.parquet
 *
 * @param namespace - Vector namespace
 * @param date - Date for partition (YYYY-MM-DD format)
 * @param timestamp - Unique timestamp for filename
 * @returns R2 path string
 *
 * @example
 * ```typescript
 * const path = generateParquetPath('payments.do', '2026-01-09', Date.now())
 * // => 'vectors/ns=payments.do/dt=2026-01-09/vectors_1736438400000.parquet'
 * ```
 */
export function generateParquetPath(
  namespace: string,
  date: string,
  timestamp: number = Date.now()
): string {
  return `vectors/ns=${namespace}/dt=${date}/vectors_${timestamp}.parquet`
}
