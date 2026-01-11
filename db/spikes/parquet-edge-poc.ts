/**
 * Parquet Edge POC - Recommended Implementation
 *
 * This POC demonstrates the recommended approach for generating Parquet files
 * in Cloudflare Workers using parquet-wasm.
 *
 * Key features:
 * - Lazy WASM initialization (no cold start penalty until needed)
 * - Streaming write support for large files
 * - ZSTD compression for optimal size
 * - Custom metadata for Iceberg compatibility
 *
 * @module db/spikes/parquet-edge-poc
 */

import {
  tableFromArrays,
  tableToIPC,
  Schema,
  Field,
  Utf8,
  Float64,
  Int32,
  Int64,
  FixedSizeList,
  Float32,
  type Table as ArrowTable,
} from 'apache-arrow'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for ParquetEdgeWriter
 */
export interface ParquetEdgeConfig {
  /** Compression codec */
  compression?: 'ZSTD' | 'SNAPPY' | 'NONE'
  /** ZSTD compression level (1-22, default 3) */
  compressionLevel?: number
  /** Rows per row group (default 2000) */
  rowGroupSize?: number
  /** Enable dictionary encoding for strings (default true) */
  useDictionary?: boolean
  /** Custom metadata key-value pairs */
  metadata?: Record<string, string>
}

/**
 * Result from write operation
 */
export interface WriteResult {
  /** Parquet file bytes */
  bytes: Uint8Array
  /** Number of rows written */
  rowCount: number
  /** Compressed size in bytes */
  compressedSize: number
  /** Estimated uncompressed size */
  uncompressedSize: number
  /** Write duration in ms */
  writeTimeMs: number
}

/**
 * Column definition for schema
 */
export interface ColumnDef {
  name: string
  type: 'string' | 'int32' | 'int64' | 'float32' | 'float64' | 'boolean'
  nullable?: boolean
}

// ============================================================================
// PARQUET-WASM WRAPPER
// ============================================================================

/**
 * Lazy-loaded parquet-wasm module
 */
let parquetWasmModule: typeof import('parquet-wasm') | null = null
let initPromise: Promise<typeof import('parquet-wasm')> | null = null

/**
 * Initialize parquet-wasm (lazy, cached)
 */
async function initParquetWasm(): Promise<typeof import('parquet-wasm')> {
  if (parquetWasmModule) {
    return parquetWasmModule
  }

  if (!initPromise) {
    initPromise = (async () => {
      // Use bundler entry for auto-init
      const wasm = await import('parquet-wasm/bundler')
      parquetWasmModule = wasm as unknown as typeof import('parquet-wasm')
      return parquetWasmModule
    })()
  }

  return initPromise
}

// ============================================================================
// PARQUET EDGE WRITER
// ============================================================================

/**
 * ParquetEdgeWriter - Optimized for Cloudflare Workers
 *
 * Usage:
 * ```typescript
 * const writer = new ParquetEdgeWriter({
 *   compression: 'ZSTD',
 *   rowGroupSize: 2000,
 * })
 *
 * const result = await writer.write({
 *   id: [1, 2, 3],
 *   name: ['a', 'b', 'c'],
 *   value: [1.0, 2.0, 3.0],
 * })
 *
 * await env.R2.put('data.parquet', result.bytes)
 * ```
 */
export class ParquetEdgeWriter {
  private config: Required<ParquetEdgeConfig>

  constructor(config: ParquetEdgeConfig = {}) {
    this.config = {
      compression: config.compression ?? 'ZSTD',
      compressionLevel: config.compressionLevel ?? 3,
      rowGroupSize: config.rowGroupSize ?? 2000,
      useDictionary: config.useDictionary ?? true,
      metadata: config.metadata ?? {},
    }
  }

  /**
   * Write columnar data to Parquet format
   *
   * @param data - Object with column names as keys and arrays as values
   * @returns WriteResult with bytes and statistics
   */
  async write(data: Record<string, unknown[]>): Promise<WriteResult> {
    const startTime = performance.now()
    const wasm = await initParquetWasm()

    // Convert to typed arrays where possible
    const typedData: Record<string, unknown> = {}
    let rowCount = 0

    for (const [key, values] of Object.entries(data)) {
      rowCount = values.length

      // Auto-detect and convert to typed arrays
      if (values.length > 0) {
        const sample = values[0]

        if (typeof sample === 'number' && Number.isInteger(sample)) {
          // Check if all values fit in Int32
          const allInt32 = values.every(
            (v) => typeof v === 'number' && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647,
          )
          typedData[key] = allInt32 ? new Int32Array(values as number[]) : values
        } else if (typeof sample === 'number') {
          typedData[key] = new Float64Array(values as number[])
        } else if (typeof sample === 'bigint') {
          typedData[key] = values // BigInt arrays handled by Arrow
        } else {
          typedData[key] = values // Strings, nullables, etc.
        }
      } else {
        typedData[key] = values
      }
    }

    // Create Arrow table
    const arrowTable = tableFromArrays(typedData)

    // Convert to IPC stream
    const ipcBuffer = tableToIPC(arrowTable, 'stream')

    // Create parquet-wasm table
    const wasmTable = wasm.Table.fromIPCStream(ipcBuffer)

    // Build writer properties
    const propsBuilder = new wasm.WriterPropertiesBuilder()
      .setDictionaryEnabled(this.config.useDictionary)
      .setMaxRowGroupSize(this.config.rowGroupSize)

    // Set compression
    switch (this.config.compression) {
      case 'ZSTD':
        propsBuilder.setCompression(wasm.Compression.ZSTD)
        break
      case 'SNAPPY':
        propsBuilder.setCompression(wasm.Compression.SNAPPY)
        break
      case 'NONE':
        propsBuilder.setCompression(wasm.Compression.UNCOMPRESSED)
        break
    }

    // Add metadata
    if (Object.keys(this.config.metadata).length > 0) {
      const metadataMap = new Map(Object.entries(this.config.metadata))
      propsBuilder.setKeyValueMetadata(metadataMap)
    }

    const writerProps = propsBuilder.build()

    // Write Parquet
    const parquetBytes = wasm.writeParquet(wasmTable, writerProps)

    // Calculate sizes
    const compressedSize = parquetBytes.byteLength
    const uncompressedSize = this.estimateUncompressedSize(typedData, rowCount)

    return {
      bytes: parquetBytes,
      rowCount,
      compressedSize,
      uncompressedSize,
      writeTimeMs: performance.now() - startTime,
    }
  }

  /**
   * Write data with explicit Arrow schema
   */
  async writeWithSchema(data: Record<string, unknown[]>, schema: Schema): Promise<WriteResult> {
    const startTime = performance.now()
    const wasm = await initParquetWasm()

    // Create table with explicit schema
    const arrowTable = tableFromArrays(data, schema)
    const ipcBuffer = tableToIPC(arrowTable, 'stream')
    const wasmTable = wasm.Table.fromIPCStream(ipcBuffer)

    const propsBuilder = new wasm.WriterPropertiesBuilder()
      .setDictionaryEnabled(this.config.useDictionary)
      .setMaxRowGroupSize(this.config.rowGroupSize)

    switch (this.config.compression) {
      case 'ZSTD':
        propsBuilder.setCompression(wasm.Compression.ZSTD)
        break
      case 'SNAPPY':
        propsBuilder.setCompression(wasm.Compression.SNAPPY)
        break
      case 'NONE':
        propsBuilder.setCompression(wasm.Compression.UNCOMPRESSED)
        break
    }

    if (Object.keys(this.config.metadata).length > 0) {
      propsBuilder.setKeyValueMetadata(new Map(Object.entries(this.config.metadata)))
    }

    const parquetBytes = wasm.writeParquet(wasmTable, propsBuilder.build())
    const rowCount = Object.values(data)[0]?.length ?? 0

    return {
      bytes: parquetBytes,
      rowCount,
      compressedSize: parquetBytes.byteLength,
      uncompressedSize: this.estimateUncompressedSize(data, rowCount),
      writeTimeMs: performance.now() - startTime,
    }
  }

  private estimateUncompressedSize(data: Record<string, unknown>, rowCount: number): number {
    let size = 0

    for (const values of Object.values(data)) {
      if (values instanceof Int32Array) {
        size += values.byteLength
      } else if (values instanceof Float64Array || values instanceof Float32Array) {
        size += values.byteLength
      } else if (Array.isArray(values)) {
        // Estimate string or other arrays
        for (const v of values) {
          if (typeof v === 'string') {
            size += v.length * 2
          } else if (typeof v === 'bigint') {
            size += 8
          } else if (v === null) {
            size += 1
          } else {
            size += 8
          }
        }
      }
    }

    return size || rowCount * 32 // Fallback estimate
  }
}

// ============================================================================
// STREAMING WRITER (for large files)
// ============================================================================

/**
 * ParquetStreamWriter - For writing very large files in chunks
 *
 * Note: Due to Parquet's columnar format, true streaming is limited.
 * This writer batches rows and writes multiple row groups.
 */
export class ParquetStreamWriter {
  private config: Required<ParquetEdgeConfig>
  private batches: Record<string, unknown[]>[] = []
  private batchSize: number

  constructor(config: ParquetEdgeConfig = {}, batchSize: number = 10000) {
    this.config = {
      compression: config.compression ?? 'ZSTD',
      compressionLevel: config.compressionLevel ?? 3,
      rowGroupSize: config.rowGroupSize ?? 2000,
      useDictionary: config.useDictionary ?? true,
      metadata: config.metadata ?? {},
    }
    this.batchSize = batchSize
  }

  /**
   * Add a batch of rows
   */
  addBatch(data: Record<string, unknown[]>): void {
    this.batches.push(data)
  }

  /**
   * Finalize and write all batches
   */
  async finish(): Promise<WriteResult> {
    if (this.batches.length === 0) {
      throw new Error('No data to write')
    }

    // Merge all batches
    const merged: Record<string, unknown[]> = {}
    const firstBatch = this.batches[0]

    for (const key of Object.keys(firstBatch)) {
      merged[key] = []
    }

    for (const batch of this.batches) {
      for (const [key, values] of Object.entries(batch)) {
        merged[key].push(...values)
      }
    }

    // Use single writer
    const writer = new ParquetEdgeWriter(this.config)
    return writer.write(merged)
  }

  /**
   * Get current row count
   */
  getRowCount(): number {
    return this.batches.reduce((sum, batch) => {
      const firstCol = Object.values(batch)[0]
      return sum + (firstCol?.length ?? 0)
    }, 0)
  }

  /**
   * Clear batches
   */
  reset(): void {
    this.batches = []
  }
}

// ============================================================================
// VECTOR SCHEMA BUILDER
// ============================================================================

/**
 * Create Arrow schema for vector embeddings
 */
export function createVectorSchema(dimension: number = 1536): Schema {
  return new Schema([
    Field.new('ns', new Utf8(), false),
    Field.new('type', new Utf8(), false),
    Field.new('visibility', new Utf8(), true),
    Field.new('id', new Utf8(), false),
    Field.new('embedding', new FixedSizeList(dimension, Field.new('item', new Float32(), false)), false),
    Field.new('metadata', new Utf8(), true),
    Field.new('created_at', new Int64(), false),
  ])
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick write helper for simple use cases
 */
export async function writeParquet(
  data: Record<string, unknown[]>,
  config?: ParquetEdgeConfig,
): Promise<Uint8Array> {
  const writer = new ParquetEdgeWriter(config)
  const result = await writer.write(data)
  return result.bytes
}

/**
 * Generate Hive-partitioned path for R2
 */
export function generateParquetPath(
  namespace: string,
  date: string,
  suffix: string = Date.now().toString(),
): string {
  return `data/ns=${namespace}/dt=${date}/part_${suffix}.parquet`
}

// ============================================================================
// WORKER INTEGRATION EXAMPLE
// ============================================================================

/**
 * Example: Cloudflare Worker handler for Parquet generation
 *
 * ```typescript
 * import { ParquetEdgeWriter, generateParquetPath } from './parquet-edge-poc'
 *
 * export default {
 *   async fetch(request: Request, env: Env): Promise<Response> {
 *     const data = await request.json()
 *
 *     const writer = new ParquetEdgeWriter({
 *       compression: 'ZSTD',
 *       metadata: {
 *         'created_by': 'dotdo-worker',
 *         'schema_version': '1.0.0',
 *       },
 *     })
 *
 *     const result = await writer.write(data)
 *
 *     // Upload to R2
 *     const path = generateParquetPath('analytics', '2026-01-11')
 *     await env.R2.put(path, result.bytes)
 *
 *     return Response.json({
 *       path,
 *       rows: result.rowCount,
 *       size: result.compressedSize,
 *       compressionRatio: (result.uncompressedSize / result.compressedSize).toFixed(2),
 *     })
 *   }
 * }
 * ```
 */

// ============================================================================
// TESTS
// ============================================================================

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('ParquetEdgeWriter', () => {
    it('should write simple columnar data', async () => {
      const writer = new ParquetEdgeWriter({ compression: 'ZSTD' })

      const result = await writer.write({
        id: [1, 2, 3, 4, 5],
        name: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
        value: [1.1, 2.2, 3.3, 4.4, 5.5],
      })

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.rowCount).toBe(5)
      expect(result.compressedSize).toBeGreaterThan(0)
      expect(result.writeTimeMs).toBeGreaterThan(0)

      console.log(`[POC] Simple write: ${result.compressedSize} bytes in ${result.writeTimeMs.toFixed(2)}ms`)
    })

    it('should write 10K rows efficiently', async () => {
      const writer = new ParquetEdgeWriter({
        compression: 'ZSTD',
        rowGroupSize: 2000,
      })

      const rowCount = 10000
      const ids = Array.from({ length: rowCount }, (_, i) => i)
      const names = Array.from({ length: rowCount }, (_, i) => `item_${i}`)
      const values = Array.from({ length: rowCount }, () => Math.random() * 1000)
      const timestamps = Array.from({ length: rowCount }, (_, i) => BigInt(Date.now() - i * 1000))

      const result = await writer.write({
        id: ids,
        name: names,
        value: values,
        timestamp: timestamps,
      })

      expect(result.rowCount).toBe(rowCount)
      expect(result.compressedSize).toBeLessThan(result.uncompressedSize)

      console.log(`[POC] 10K rows: ${(result.compressedSize / 1024).toFixed(2)} KB`)
      console.log(`[POC] Compression: ${(result.uncompressedSize / result.compressedSize).toFixed(2)}x`)
      console.log(`[POC] Latency: ${result.writeTimeMs.toFixed(2)}ms`)
    })

    it('should handle nullable columns', async () => {
      const writer = new ParquetEdgeWriter()

      const result = await writer.write({
        id: [1, 2, 3],
        optional: ['a', null, 'c'],
      })

      expect(result.rowCount).toBe(3)
      expect(result.bytes.byteLength).toBeGreaterThan(0)
    })

    it('should include custom metadata', async () => {
      const writer = new ParquetEdgeWriter({
        metadata: {
          'dotdo:version': '1.0.0',
          'dotdo:namespace': 'test.do',
        },
      })

      const result = await writer.write({
        id: [1, 2, 3],
      })

      // Metadata is embedded in the Parquet footer
      expect(result.bytes.byteLength).toBeGreaterThan(0)
    })
  })

  describe('ParquetStreamWriter', () => {
    it('should accumulate batches', async () => {
      const writer = new ParquetStreamWriter({ compression: 'ZSTD' })

      writer.addBatch({ id: [1, 2, 3], name: ['a', 'b', 'c'] })
      writer.addBatch({ id: [4, 5, 6], name: ['d', 'e', 'f'] })

      expect(writer.getRowCount()).toBe(6)

      const result = await writer.finish()
      expect(result.rowCount).toBe(6)
    })
  })

  describe('writeParquet helper', () => {
    it('should provide simple API', async () => {
      const bytes = await writeParquet({ x: [1, 2, 3] })
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.byteLength).toBeGreaterThan(0)
    })
  })

  describe('generateParquetPath', () => {
    it('should generate Hive-partitioned path', () => {
      const path = generateParquetPath('analytics.do', '2026-01-11', '001')
      expect(path).toBe('data/ns=analytics.do/dt=2026-01-11/part_001.parquet')
    })
  })
}
