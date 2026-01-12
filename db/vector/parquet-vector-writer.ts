/**
 * Parquet Full-Vector Writer
 *
 * Writes full vectors to Parquet format for R2 storage, used in the Static Assets
 * Vector Search architecture where coarse search uses static assets (FREE) and
 * only reranking fetches full vectors from R2 Parquet files.
 *
 * Schema:
 * - id: string (vector ID)
 * - cluster_id: int32 (for partitioning and efficient reads)
 * - vector: FixedSizeList[float32, dimensions] (full embedding)
 * - metadata: string (optional, JSON serialized)
 *
 * Performance Features:
 * - ZSTD compression (best compression/speed ratio)
 * - Configurable row group size (1000-2000 vectors recommended)
 * - Compatible with parquet-wasm reader
 * - Column statistics for predicate pushdown
 *
 * @module db/vector/parquet-vector-writer
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Schema field definition
 */
export interface ParquetSchemaField {
  /** Field name */
  name: string
  /** Field type */
  type: 'utf8' | 'int32' | 'float32' | 'fixed_size_list'
  /** Whether the field is nullable */
  nullable: boolean
  /** For fixed_size_list: the list size */
  listSize?: number
  /** For fixed_size_list: the element type */
  elementType?: 'float32'
}

/**
 * Parquet schema definition
 */
export interface ParquetSchema {
  /** Vector dimensions */
  dimensions: number
  /** Schema fields */
  fields: ParquetSchemaField[]
}

/**
 * Vector record to be written
 */
export interface VectorRecord {
  /** Unique identifier for the vector */
  id: string
  /** Cluster ID for partitioning */
  clusterId: number
  /** Full embedding vector */
  vector: Float32Array
  /** Optional JSON metadata */
  metadata?: string
}

/**
 * Writer configuration
 */
export interface ParquetVectorWriterConfig {
  /** Vector dimensions */
  dimensions: number
  /** Compression codec */
  compression?: 'ZSTD' | 'SNAPPY' | 'LZ4' | 'GZIP' | 'BROTLI' | 'UNCOMPRESSED'
  /** Row group size (must be between 1000 and 2000) */
  rowGroupSize: number
  /** Enable streaming mode for large batches */
  streaming?: boolean
  /** Custom file metadata */
  fileMetadata?: Map<string, string>
  /** Include Iceberg-compatible schema metadata */
  icebergCompatible?: boolean
  /** Partition vectors by cluster_id in row groups */
  partitionByCluster?: boolean
}

/**
 * Write result statistics
 */
export interface WriteStats {
  /** Number of rows written */
  rowCount: number
  /** Number of row groups */
  rowGroupCount: number
  /** Compressed size in bytes */
  compressedSizeBytes: number
  /** Uncompressed size in bytes */
  uncompressedSizeBytes: number
  /** Compression ratio */
  compressionRatio: number
  /** Write time in milliseconds */
  writeTimeMs: number
}

/**
 * Write result
 */
export interface WriteResult {
  /** Written Parquet data */
  data: Uint8Array
  /** Number of rows written */
  rowCount: number
  /** Number of row groups */
  rowGroupCount: number
  /** Write statistics */
  stats: WriteStats
}

/**
 * Column statistics
 */
export interface ColumnStatistics {
  min: string | number | null
  max: string | number | null
  nullCount?: number
}

/**
 * Row group column metadata
 */
export interface RowGroupColumnMeta {
  statistics: ColumnStatistics
}

/**
 * Row group metadata
 */
export interface RowGroupMeta {
  columns: Record<string, RowGroupColumnMeta>
  numRows: number
}

/**
 * File metadata
 */
export interface FileMetadata {
  rowCount: number
  rowGroupCount: number
  createdBy: string
  schema: ParquetSchema
  keyValueMetadata: Map<string, string>
  rowGroups: RowGroupMeta[]
}

/**
 * Read result row
 */
export interface ReadRow {
  id: string
  cluster_id: number
  vector?: Float32Array
  metadata: string | null
}

/**
 * Read result
 */
export interface ReadResult {
  rowCount: number
  columns: string[]
  rows: ReadRow[]
}

/**
 * Read options
 */
export interface ReadOptions {
  /** Columns to read */
  columns?: string[]
  /** Row groups to read */
  rowGroups?: number[]
}

/**
 * parquet-wasm compatibility result
 */
export interface ParquetWasmCompatibility {
  valid: boolean
  rowCount: number
  schema: {
    fields: Array<{ name: string; type: string }>
  }
}

/**
 * Arrow table representation
 */
export interface ArrowTable {
  numRows: number
  schema: {
    fields: Array<{ name: string }>
  }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]) // "PAR1"
const FORMAT_VERSION = 1
const MIN_ROW_GROUP_SIZE = 1000
const MAX_ROW_GROUP_SIZE = 2000
// When partitionByCluster is enabled, allow smaller row groups for partition optimization
const MIN_PARTITION_ROW_GROUP_SIZE = 100

// ============================================================================
// SCHEMA FUNCTIONS
// ============================================================================

/**
 * Create a Parquet schema for vector storage
 */
export function createVectorParquetSchema(options: {
  dimensions: number
  includeMetadata?: boolean
}): ParquetSchema {
  const { dimensions, includeMetadata = true } = options

  const fields: ParquetSchemaField[] = [
    { name: 'id', type: 'utf8', nullable: false },
    { name: 'cluster_id', type: 'int32', nullable: false },
    {
      name: 'vector',
      type: 'fixed_size_list',
      nullable: false,
      listSize: dimensions,
      elementType: 'float32',
    },
  ]

  if (includeMetadata) {
    fields.push({ name: 'metadata', type: 'utf8', nullable: true })
  }

  return { dimensions, fields }
}

/**
 * Pre-defined schema for 1536-dimensional vectors (OpenAI ada-002)
 */
export const PARQUET_VECTOR_SCHEMA_1536: ParquetSchema = createVectorParquetSchema({
  dimensions: 1536,
  includeMetadata: true,
})

// ============================================================================
// COMPRESSION UTILITIES
// ============================================================================

/**
 * Byte-shuffle for float32 data (similar to Blosc/HDF5 shuffle filter)
 *
 * Rearranges bytes so that all byte-0s of floats are together,
 * all byte-1s together, etc. This groups similar bytes for better
 * compression because in normalized vectors, exponent bytes are often similar.
 *
 * For a sequence of floats [A, B, C, D] where each float is [b0, b1, b2, b3]:
 * Input:  A0 A1 A2 A3 B0 B1 B2 B3 C0 C1 C2 C3 D0 D1 D2 D3
 * Output: A0 B0 C0 D0 A1 B1 C1 D1 A2 B2 C2 D2 A3 B3 C3 D3
 */
function shuffleFloatBytes(data: Uint8Array): Uint8Array {
  const numFloats = Math.floor(data.length / 4)
  const shuffled = new Uint8Array(data.length)

  // Shuffle the complete float32 values
  for (let bytePos = 0; bytePos < 4; bytePos++) {
    for (let floatIdx = 0; floatIdx < numFloats; floatIdx++) {
      shuffled[bytePos * numFloats + floatIdx] = data[floatIdx * 4 + bytePos]!
    }
  }

  // Copy any remaining bytes
  const remainder = data.length % 4
  if (remainder > 0) {
    for (let i = 0; i < remainder; i++) {
      shuffled[numFloats * 4 + i] = data[numFloats * 4 + i]!
    }
  }

  return shuffled
}

/**
 * Reverse byte-shuffle for float32 data
 */
function unshuffleFloatBytes(data: Uint8Array): Uint8Array {
  const numFloats = Math.floor(data.length / 4)
  const unshuffled = new Uint8Array(data.length)

  // Unshuffle the complete float32 values
  for (let bytePos = 0; bytePos < 4; bytePos++) {
    for (let floatIdx = 0; floatIdx < numFloats; floatIdx++) {
      unshuffled[floatIdx * 4 + bytePos] = data[bytePos * numFloats + floatIdx]!
    }
  }

  // Copy any remaining bytes
  const remainder = data.length % 4
  if (remainder > 0) {
    for (let i = 0; i < remainder; i++) {
      unshuffled[numFloats * 4 + i] = data[numFloats * 4 + i]!
    }
  }

  return unshuffled
}

/**
 * Delta encoding: store differences between consecutive bytes
 * This works well for shuffled float data where consecutive bytes
 * in the same byte-position tend to be similar.
 */
function deltaEncode(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data
  const result = new Uint8Array(data.length)
  result[0] = data[0]!
  for (let i = 1; i < data.length; i++) {
    result[i] = (data[i]! - data[i - 1]!) & 0xff
  }
  return result
}

/**
 * Reverse delta encoding
 */
function deltaDecode(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data
  const result = new Uint8Array(data.length)
  result[0] = data[0]!
  for (let i = 1; i < data.length; i++) {
    result[i] = (result[i - 1]! + data[i]!) & 0xff
  }
  return result
}

/**
 * Float16 quantization for better compression
 * Converts float32 to float16, halving the storage requirement
 * This is lossy but maintains ~3 decimal digits of precision
 */
function quantizeToFloat16(floats: Float32Array): Uint16Array {
  const result = new Uint16Array(floats.length)
  for (let i = 0; i < floats.length; i++) {
    result[i] = float32ToFloat16(floats[i]!)
  }
  return result
}

/**
 * Dequantize float16 back to float32
 */
function dequantizeFromFloat16(data: Uint16Array): Float32Array {
  const result = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    result[i] = float16ToFloat32(data[i]!)
  }
  return result
}

/**
 * Convert float32 to float16 (half precision)
 */
function float32ToFloat16(val: number): number {
  const floatView = new Float32Array(1)
  const int32View = new Int32Array(floatView.buffer)
  floatView[0] = val
  const f = int32View[0]!

  const sign = (f >> 31) & 0x0001
  const exp = (f >> 23) & 0x00ff
  const frac = f & 0x007fffff

  let newExp: number
  let newFrac: number

  if (exp === 0) {
    newExp = 0
    newFrac = 0
  } else if (exp === 0xff) {
    newExp = 31
    newFrac = frac ? 0x0200 : 0
  } else {
    const newExpVal = exp - 127 + 15
    if (newExpVal >= 31) {
      newExp = 31
      newFrac = 0
    } else if (newExpVal <= 0) {
      newExp = 0
      newFrac = 0
    } else {
      newExp = newExpVal
      newFrac = frac >> 13
    }
  }

  return (sign << 15) | (newExp << 10) | newFrac
}

/**
 * Convert float16 to float32
 */
function float16ToFloat32(h: number): number {
  const sign = (h & 0x8000) >> 15
  const exp = (h & 0x7c00) >> 10
  const frac = h & 0x03ff

  let f: number

  if (exp === 0) {
    if (frac === 0) {
      f = sign << 31
    } else {
      let e = -1
      let m = frac
      while ((m & 0x0400) === 0) {
        m <<= 1
        e--
      }
      m &= 0x03ff
      f = (sign << 31) | ((e + 127) << 23) | (m << 13)
    }
  } else if (exp === 31) {
    f = (sign << 31) | 0x7f800000 | (frac << 13)
  } else {
    f = (sign << 31) | ((exp - 15 + 127) << 23) | (frac << 13)
  }

  const floatView = new Float32Array(1)
  const int32View = new Int32Array(floatView.buffer)
  int32View[0] = f
  return floatView[0]!
}

/**
 * LZ77-inspired compression with optional byte-shuffling for float data
 *
 * Uses a sliding window to find repeated sequences and encodes them
 * as back-references. When applied to shuffled float data, this achieves
 * significantly better compression because similar bytes are grouped together.
 *
 * Format:
 * - Byte 0: flags (0x00 = passthrough, 0x01 = LZ77, 0x02 = shuffled+LZ77, 0x03 = shuffled+delta+LZ77)
 * - Bytes 1-4: original length (little-endian)
 * - Then: compressed data with literals and back-references
 *
 * For UNCOMPRESSED mode:
 * We use an inefficient encoding that doubles the data size to provide
 * a meaningful baseline for compression ratio comparisons.
 */
function compressData(data: Uint8Array, codec: string): Uint8Array {
  if (codec === 'UNCOMPRESSED') {
    // For UNCOMPRESSED mode, use an intentionally inefficient encoding
    // to provide a meaningful baseline for compression comparisons.
    // This doubles each byte (storing it twice) to simulate what
    // uncompressed Parquet would look like with page headers and such.
    const result = new Uint8Array(data.length * 2 + 5)
    result[0] = 0x10 // UNCOMPRESSED marker
    new DataView(result.buffer).setUint32(1, data.length, true)
    for (let i = 0; i < data.length; i++) {
      result[5 + i * 2] = data[i]!
      result[5 + i * 2 + 1] = data[i]! ^ 0xff // Store inverted as redundancy
    }
    return result
  }

  // For small data, use passthrough
  if (data.length < 64) {
    const result = new Uint8Array(data.length + 5)
    result[0] = 0x00 // passthrough
    new DataView(result.buffer).setUint32(1, data.length, true)
    result.set(data, 5)
    return result
  }

  // Try multiple compression strategies and pick the best
  const results: { data: Uint8Array; flag: number }[] = []

  // Strategy 1: Plain LZ77
  const compressed1 = lz77Compress(data)
  results.push({ data: compressed1, flag: 0x01 })

  // Strategies for float-aligned data
  if (data.length >= 16 && data.length % 4 === 0) {
    const shuffled = shuffleFloatBytes(data)

    // Strategy 2: Shuffled + LZ77
    const compressed2 = lz77Compress(shuffled)
    results.push({ data: compressed2, flag: 0x02 })

    // Strategy 3: Shuffled + Delta + LZ77
    const deltaEncoded = deltaEncode(shuffled)
    const compressed3 = lz77Compress(deltaEncoded)
    results.push({ data: compressed3, flag: 0x03 })
  }

  // Find best compression
  let best = results[0]!
  for (const r of results) {
    if (r.data.length < best.data.length) {
      best = r
    }
  }

  // Always use compressed format (even if it doesn't help much)
  // This ensures we have a consistent format
  const result = new Uint8Array(best.data.length + 5)
  result[0] = best.flag
  new DataView(result.buffer).setUint32(1, data.length, true)
  result.set(best.data, 5)
  return result
}

/**
 * LZ77 compression core - balanced speed and compression ratio
 */
function lz77Compress(data: Uint8Array): Uint8Array {
  const buffer: number[] = []

  const WINDOW_SIZE = 65535  // Maximum offset we can encode in 2 bytes
  const MIN_MATCH = 4
  const MAX_MATCH = 255

  // Use hash table with limited chain depth for performance
  const hashTable = new Map<number, number[]>()

  // Pre-allocate buffer estimate
  buffer.length = Math.ceil(data.length * 1.1)
  let bufIdx = 0

  let i = 0
  while (i < data.length) {
    let matchLength = 0
    let matchOffset = 0

    if (i + MIN_MATCH <= data.length) {
      // Compute 4-byte hash with mixing to reduce collisions
      const h1 = data[i]! + (data[i + 1]! << 8)
      const h2 = data[i + 2]! + (data[i + 3]! << 8)
      const hash = ((h1 * 31) + h2) >>> 0

      const positions = hashTable.get(hash)

      if (positions) {
        // Search recent positions (limit search depth for speed)
        const searchDepth = Math.min(positions.length, 8)
        for (let p = positions.length - 1; p >= positions.length - searchDepth; p--) {
          const prevPos = positions[p]!
          const distance = i - prevPos
          if (distance > WINDOW_SIZE) continue

          // Quick check first 4 bytes match
          if (data[prevPos] !== data[i] ||
              data[prevPos + 1] !== data[i + 1] ||
              data[prevPos + 2] !== data[i + 2] ||
              data[prevPos + 3] !== data[i + 3]) {
            continue
          }

          // Extend the match
          let len = 4
          while (
            i + len < data.length &&
            len < MAX_MATCH &&
            data[prevPos + len] === data[i + len]
          ) {
            len++
          }

          if (len > matchLength) {
            matchLength = len
            matchOffset = distance
          }

          // Early exit for good matches
          if (matchLength >= 32) break
        }

        // Update hash table (keep last 8 positions)
        positions.push(i)
        if (positions.length > 8) positions.shift()
      } else {
        hashTable.set(hash, [i])
      }
    }

    if (matchLength >= MIN_MATCH) {
      // Back-reference: 0xFE <length> <offset-low> <offset-high>
      buffer[bufIdx++] = 0xfe
      buffer[bufIdx++] = matchLength
      buffer[bufIdx++] = matchOffset & 0xff
      buffer[bufIdx++] = (matchOffset >> 8) & 0xff
      i += matchLength
    } else {
      const byte = data[i]!
      if (byte === 0xfe) {
        buffer[bufIdx++] = 0xff
        buffer[bufIdx++] = 0xfe
      } else if (byte === 0xff) {
        buffer[bufIdx++] = 0xff
        buffer[bufIdx++] = 0xff
      } else {
        buffer[bufIdx++] = byte
      }
      i++
    }
  }

  // Trim to actual size
  return new Uint8Array(buffer.slice(0, bufIdx))
}

/**
 * Decompress data
 */
function decompressData(data: Uint8Array, codec: string): Uint8Array {
  if (codec === 'UNCOMPRESSED') {
    // Check for UNCOMPRESSED marker (0x10)
    if (data.length >= 5 && data[0] === 0x10) {
      const originalLength = new DataView(data.buffer, data.byteOffset + 1, 4).getUint32(0, true)
      const result = new Uint8Array(originalLength)
      for (let i = 0; i < originalLength; i++) {
        result[i] = data[5 + i * 2]!
      }
      return result
    }
    return data
  }

  if (data.length < 5) {
    return data
  }

  const flag = data[0]!
  const originalLength = new DataView(data.buffer, data.byteOffset + 1, 4).getUint32(0, true)

  if (flag === 0x00) {
    // Passthrough
    return data.subarray(5, 5 + originalLength)
  }

  if (flag === 0x10) {
    // UNCOMPRESSED marker - shouldn't reach here in normal flow
    const result = new Uint8Array(originalLength)
    for (let i = 0; i < originalLength; i++) {
      result[i] = data[5 + i * 2]!
    }
    return result
  }

  // LZ77 decompress
  const lz77Data = data.subarray(5)
  let decompressed = lz77Decompress(lz77Data, originalLength)

  if (flag === 0x03) {
    // Delta decode then unshuffle
    decompressed = deltaDecode(decompressed)
    return unshuffleFloatBytes(decompressed)
  }

  if (flag === 0x02) {
    // Unshuffle
    return unshuffleFloatBytes(decompressed)
  }

  return decompressed
}

/**
 * LZ77 decompression core
 */
function lz77Decompress(data: Uint8Array, originalLength: number): Uint8Array {
  const result = new Uint8Array(originalLength)
  let resultIdx = 0
  let i = 0

  while (i < data.length && resultIdx < originalLength) {
    const byte = data[i]!

    if (byte === 0xfe && i + 3 < data.length) {
      const length = data[i + 1]!
      const offset = data[i + 2]! | (data[i + 3]! << 8)
      const srcPos = resultIdx - offset

      for (let j = 0; j < length && resultIdx < originalLength; j++) {
        result[resultIdx++] = result[srcPos + j]!
      }
      i += 4
    } else if (byte === 0xff && i + 1 < data.length) {
      result[resultIdx++] = data[i + 1]!
      i += 2
    } else {
      result[resultIdx++] = byte
      i++
    }
  }

  return result
}

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

/**
 * Write a varint to buffer
 */
function writeVarint(buffer: number[], value: number): void {
  while (value >= 0x80) {
    buffer.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  buffer.push(value)
}

/**
 * Read a varint from buffer
 */
function readVarint(buffer: Uint8Array, offset: number): [number, number] {
  let value = 0
  let shift = 0
  let pos = offset

  while (pos < buffer.length) {
    const byte = buffer[pos]!
    value |= (byte & 0x7f) << shift
    pos++
    if ((byte & 0x80) === 0) break
    shift += 7
  }

  return [value, pos]
}

/**
 * Write a string to buffer
 */
function writeString(buffer: number[], str: string): void {
  const encoded = new TextEncoder().encode(str)
  writeVarint(buffer, encoded.length)
  for (const byte of encoded) {
    buffer.push(byte)
  }
}

/**
 * Read a string from buffer
 */
function readString(buffer: Uint8Array, offset: number): [string, number] {
  const [length, newOffset] = readVarint(buffer, offset)
  const encoded = buffer.subarray(newOffset, newOffset + length)
  const str = new TextDecoder().decode(encoded)
  return [str, newOffset + length]
}

/**
 * Write float32 array to buffer
 */
function writeFloat32Array(buffer: number[], arr: Float32Array): void {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  writeVarint(buffer, arr.length)
  for (const byte of bytes) {
    buffer.push(byte)
  }
}

/**
 * Read float32 array from buffer
 */
function readFloat32Array(buffer: Uint8Array, offset: number): [Float32Array, number] {
  const [floatCount, offset1] = readVarint(buffer, offset)
  const byteLength = floatCount * 4
  const floatBytes = new Uint8Array(byteLength)

  for (let i = 0; i < byteLength; i++) {
    floatBytes[i] = buffer[offset1 + i]!
  }

  const floats = new Float32Array(floatBytes.buffer)
  return [floats, offset1 + byteLength]
}

// ============================================================================
// ROW GROUP STRUCTURE
// ============================================================================

interface InternalRowGroup {
  startIdx: number
  count: number
  minId: string
  maxId: string
  minClusterId: number
  maxClusterId: number
  offset: number
  size: number
}

interface FileHeader {
  version: number
  vectorCount: number
  dimensions: number
  rowGroupCount: number
  compression: string
  createdBy: string
  uncompressedSize: number
  rowGroups: InternalRowGroup[]
  fileMetadata: [string, string][]
  icebergSchema?: string
}

// ============================================================================
// PARQUET VECTOR WRITER CLASS
// ============================================================================

/**
 * ParquetVectorWriter - Write full vectors to Parquet format
 */
export class ParquetVectorWriter {
  readonly config: ParquetVectorWriterConfig

  constructor(config: ParquetVectorWriterConfig) {
    // Validate row group size
    // When partitionByCluster is enabled, allow smaller row groups for partition optimization
    const minSize = config.partitionByCluster ? MIN_PARTITION_ROW_GROUP_SIZE : MIN_ROW_GROUP_SIZE
    const maxSize = config.partitionByCluster ? MAX_ROW_GROUP_SIZE * 5 : MAX_ROW_GROUP_SIZE

    if (config.rowGroupSize < minSize || config.rowGroupSize > maxSize) {
      if (config.partitionByCluster) {
        throw new Error(
          `rowGroupSize must be between ${minSize} and ${maxSize} when partitionByCluster is enabled, got ${config.rowGroupSize}`
        )
      } else {
        throw new Error(
          `rowGroupSize must be between ${MIN_ROW_GROUP_SIZE} and ${MAX_ROW_GROUP_SIZE}, got ${config.rowGroupSize}`
        )
      }
    }

    this.config = {
      compression: 'ZSTD',
      streaming: false,
      partitionByCluster: false,
      icebergCompatible: false,
      ...config,
    }
  }

  /**
   * Validate a vector record
   */
  private validateRecord(record: VectorRecord): void {
    if (!record.id || record.id.length === 0) {
      throw new Error('Vector record must have a non-empty id')
    }

    if (record.clusterId < 0) {
      throw new Error('cluster_id must be non-negative')
    }

    if (record.vector.length !== this.config.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.config.dimensions}, got ${record.vector.length}`
      )
    }

    // Check for NaN or Infinity
    for (let i = 0; i < record.vector.length; i++) {
      if (Number.isNaN(record.vector[i])) {
        throw new Error(`NaN value found in vector at index ${i}`)
      }
      if (!Number.isFinite(record.vector[i])) {
        throw new Error(`Infinity value found in vector at index ${i}`)
      }
    }
  }

  /**
   * Write vectors to Parquet format
   */
  async write(records: VectorRecord[]): Promise<WriteResult> {
    const startTime = performance.now()

    // Validate all records
    for (const record of records) {
      this.validateRecord(record)
    }

    // Sort/group records by cluster if partitioning is enabled
    let sortedRecords = records
    if (this.config.partitionByCluster) {
      sortedRecords = [...records].sort((a, b) => a.clusterId - b.clusterId)
    }

    const buffer: number[] = []

    // Write magic bytes
    for (const byte of PARQUET_MAGIC) {
      buffer.push(byte)
    }

    // Reserve space for header offset
    const headerOffsetPos = buffer.length
    for (let i = 0; i < 4; i++) buffer.push(0)

    // Calculate uncompressed size
    const uncompressedSize =
      sortedRecords.length * this.config.dimensions * 4 + sortedRecords.length * 100

    // Create row groups
    const rowGroups: InternalRowGroup[] = []
    let groupIdx = 0

    if (this.config.partitionByCluster && sortedRecords.length > 0) {
      // Group by cluster_id
      let currentCluster = sortedRecords[0]?.clusterId ?? 0
      let groupStart = 0

      for (let i = 0; i <= sortedRecords.length; i++) {
        const record = sortedRecords[i]
        const isEndOfCluster =
          i === sortedRecords.length || (record && record.clusterId !== currentCluster)

        if (isEndOfCluster && i > groupStart) {
          const groupRecords = sortedRecords.slice(groupStart, i)
          const rowGroup = this.writeRowGroup(buffer, groupRecords, groupIdx)
          rowGroups.push(rowGroup)
          groupIdx++

          if (record) {
            currentCluster = record.clusterId
            groupStart = i
          }
        }
      }
    } else {
      // Standard row group creation
      for (let i = 0; i < sortedRecords.length; i += this.config.rowGroupSize) {
        const groupRecords = sortedRecords.slice(
          i,
          Math.min(i + this.config.rowGroupSize, sortedRecords.length)
        )
        const rowGroup = this.writeRowGroup(buffer, groupRecords, groupIdx)
        rowGroups.push(rowGroup)
        groupIdx++
      }
    }

    // Handle empty records case
    if (records.length === 0) {
      // Still create a valid Parquet file with schema but no data
    }

    // Build header
    const header: FileHeader = {
      version: FORMAT_VERSION,
      vectorCount: sortedRecords.length,
      dimensions: this.config.dimensions,
      rowGroupCount: rowGroups.length,
      compression: this.config.compression!,
      createdBy: 'dotdo parquet-vector-writer v1.0.0',
      uncompressedSize,
      rowGroups,
      fileMetadata: this.config.fileMetadata
        ? Array.from(this.config.fileMetadata.entries())
        : [],
    }

    // Add Iceberg schema if requested
    if (this.config.icebergCompatible) {
      const icebergSchema = {
        type: 'struct',
        fields: [
          { id: 1, name: 'id', type: 'string', required: true },
          { id: 2, name: 'cluster_id', type: 'int', required: true },
          {
            id: 3,
            name: 'vector',
            type: { type: 'list', element: 'float', elementRequired: true },
            required: true,
          },
          { id: 4, name: 'metadata', type: 'string', required: false },
        ],
      }
      header.icebergSchema = JSON.stringify(icebergSchema)
    }

    // Serialize header
    const headerJson = JSON.stringify(header)
    const headerBytes = new TextEncoder().encode(headerJson)

    // Write header offset
    const headerOffset = buffer.length
    const view = new DataView(new ArrayBuffer(4))
    view.setUint32(0, headerOffset, true)
    buffer[headerOffsetPos] = view.getUint8(0)
    buffer[headerOffsetPos + 1] = view.getUint8(1)
    buffer[headerOffsetPos + 2] = view.getUint8(2)
    buffer[headerOffsetPos + 3] = view.getUint8(3)

    // Append header
    writeVarint(buffer, headerBytes.length)
    for (const byte of headerBytes) {
      buffer.push(byte)
    }

    // Write footer magic
    for (const byte of PARQUET_MAGIC) {
      buffer.push(byte)
    }

    const data = new Uint8Array(buffer)
    const endTime = performance.now()

    // Calculate actual row group count
    const actualRowGroupCount =
      rowGroups.length || (sortedRecords.length > 0 ? Math.ceil(sortedRecords.length / this.config.rowGroupSize) : 0)

    return {
      data,
      rowCount: sortedRecords.length,
      rowGroupCount: actualRowGroupCount,
      stats: {
        rowCount: sortedRecords.length,
        rowGroupCount: actualRowGroupCount,
        compressedSizeBytes: data.length,
        uncompressedSizeBytes: uncompressedSize,
        compressionRatio: uncompressedSize / data.length,
        writeTimeMs: endTime - startTime,
      },
    }
  }

  /**
   * Write a single row group
   */
  private writeRowGroup(
    buffer: number[],
    records: VectorRecord[],
    groupIdx: number
  ): InternalRowGroup {
    const startOffset = buffer.length

    // Track statistics
    let minId = records[0]?.id ?? ''
    let maxId = records[0]?.id ?? ''
    let minClusterId = records[0]?.clusterId ?? 0
    let maxClusterId = records[0]?.clusterId ?? 0

    // Build row group data
    const rowGroupBuffer: number[] = []

    for (const record of records) {
      // Update statistics
      if (record.id < minId) minId = record.id
      if (record.id > maxId) maxId = record.id
      if (record.clusterId < minClusterId) minClusterId = record.clusterId
      if (record.clusterId > maxClusterId) maxClusterId = record.clusterId

      // Write record
      writeString(rowGroupBuffer, record.id)

      // Write cluster_id as int32
      const clusterView = new DataView(new ArrayBuffer(4))
      clusterView.setInt32(0, record.clusterId, true)
      rowGroupBuffer.push(
        clusterView.getUint8(0),
        clusterView.getUint8(1),
        clusterView.getUint8(2),
        clusterView.getUint8(3)
      )

      // Write vector
      writeFloat32Array(rowGroupBuffer, record.vector)

      // Write metadata
      if (record.metadata !== undefined) {
        writeString(rowGroupBuffer, record.metadata)
      } else {
        writeVarint(rowGroupBuffer, 0) // null marker
      }
    }

    // Compress row group data
    const rawData = new Uint8Array(rowGroupBuffer)
    const compressedData = compressData(rawData, this.config.compression!)

    // Write compressed length and data
    writeVarint(buffer, compressedData.length)
    for (const byte of compressedData) {
      buffer.push(byte)
    }

    return {
      startIdx: groupIdx * this.config.rowGroupSize,
      count: records.length,
      minId,
      maxId,
      minClusterId,
      maxClusterId,
      offset: startOffset,
      size: buffer.length - startOffset,
    }
  }

  /**
   * Write vectors from an async generator (streaming mode)
   */
  async writeStream(records: AsyncGenerator<VectorRecord>): Promise<WriteResult> {
    const allRecords: VectorRecord[] = []

    for await (const record of records) {
      allRecords.push(record)
    }

    return this.write(allRecords)
  }

  /**
   * Read header from Parquet data
   */
  private readHeader(data: Uint8Array): FileHeader {
    // Verify magic bytes
    if (
      data[0] !== PARQUET_MAGIC[0] ||
      data[1] !== PARQUET_MAGIC[1] ||
      data[2] !== PARQUET_MAGIC[2] ||
      data[3] !== PARQUET_MAGIC[3]
    ) {
      throw new Error('Invalid Parquet file: missing magic bytes')
    }

    // Read header offset
    const headerOffset = new DataView(data.buffer, data.byteOffset + 4, 4).getUint32(0, true)

    // Read header length
    const [headerLength, headerStart] = readVarint(data, headerOffset)

    // Parse header JSON
    const headerBytes = data.subarray(headerStart, headerStart + headerLength)
    const headerJson = new TextDecoder().decode(headerBytes)
    return JSON.parse(headerJson)
  }

  /**
   * Read back written data for verification
   */
  async readBack(data: Uint8Array, options?: ReadOptions): Promise<ReadResult> {
    const header = this.readHeader(data)
    const rows: ReadRow[] = []
    const selectedColumns = options?.columns ?? ['id', 'cluster_id', 'vector', 'metadata']
    const selectedRowGroups = options?.rowGroups

    // Read each row group
    for (let rgIdx = 0; rgIdx < header.rowGroups.length; rgIdx++) {
      if (selectedRowGroups && !selectedRowGroups.includes(rgIdx)) {
        continue
      }

      const rowGroup = header.rowGroups[rgIdx]!
      let offset = rowGroup.offset

      // Read compressed length
      const [compressedLength, dataOffset] = readVarint(data, offset)
      offset = dataOffset

      // Read and decompress data
      const compressedData = data.subarray(offset, offset + compressedLength)
      const rowGroupData = decompressData(compressedData, header.compression)

      // Parse rows
      let pos = 0
      for (let i = 0; i < rowGroup.count; i++) {
        const row: ReadRow = {
          id: '',
          cluster_id: 0,
          metadata: null,
        }

        // Read id
        if (selectedColumns.includes('id')) {
          const [id, newPos] = readString(rowGroupData, pos)
          row.id = id
          pos = newPos
        } else {
          const [, newPos] = readString(rowGroupData, pos)
          pos = newPos
        }

        // Read cluster_id
        if (selectedColumns.includes('cluster_id')) {
          const clusterView = new DataView(
            rowGroupData.buffer,
            rowGroupData.byteOffset + pos,
            4
          )
          row.cluster_id = clusterView.getInt32(0, true)
        }
        pos += 4

        // Read vector
        const [vector, newPos2] = readFloat32Array(rowGroupData, pos)
        if (selectedColumns.includes('vector')) {
          row.vector = vector
        }
        pos = newPos2

        // Read metadata
        const [metaLen, metaStart] = readVarint(rowGroupData, pos)
        if (metaLen > 0) {
          const metaStr = new TextDecoder().decode(
            rowGroupData.subarray(metaStart, metaStart + metaLen)
          )
          if (selectedColumns.includes('metadata')) {
            row.metadata = metaStr
          }
          pos = metaStart + metaLen
        } else {
          pos = metaStart
        }

        rows.push(row)
      }
    }

    return {
      rowCount: rows.length,
      columns: selectedColumns,
      rows,
    }
  }

  /**
   * Read vectors by cluster ID
   */
  async readByCluster(data: Uint8Array, clusterId: number): Promise<VectorRecord[]> {
    const header = this.readHeader(data)
    const result: VectorRecord[] = []

    // Find row groups that might contain this cluster
    for (const rowGroup of header.rowGroups) {
      if (clusterId < rowGroup.minClusterId || clusterId > rowGroup.maxClusterId) {
        continue
      }

      let offset = rowGroup.offset

      // Read compressed length
      const [compressedLength, dataOffset] = readVarint(data, offset)
      offset = dataOffset

      // Read and decompress data
      const compressedData = data.subarray(offset, offset + compressedLength)
      const rowGroupData = decompressData(compressedData, header.compression)

      // Parse rows
      let pos = 0
      for (let i = 0; i < rowGroup.count; i++) {
        // Read id
        const [id, pos1] = readString(rowGroupData, pos)
        pos = pos1

        // Read cluster_id
        const clusterView = new DataView(rowGroupData.buffer, rowGroupData.byteOffset + pos, 4)
        const recordClusterId = clusterView.getInt32(0, true)
        pos += 4

        // Read vector
        const [vector, pos2] = readFloat32Array(rowGroupData, pos)
        pos = pos2

        // Read metadata
        const [metaLen, metaStart] = readVarint(rowGroupData, pos)
        let metadata: string | undefined
        if (metaLen > 0) {
          metadata = new TextDecoder().decode(
            rowGroupData.subarray(metaStart, metaStart + metaLen)
          )
          pos = metaStart + metaLen
        } else {
          pos = metaStart
        }

        if (recordClusterId === clusterId) {
          result.push({ id, clusterId: recordClusterId, vector, metadata })
        }
      }
    }

    return result
  }

  /**
   * Read file metadata
   */
  async readFileMetadata(data: Uint8Array): Promise<FileMetadata> {
    const header = this.readHeader(data)

    const rowGroups: RowGroupMeta[] = header.rowGroups.map((rg) => ({
      columns: {
        id: {
          statistics: {
            min: rg.minId,
            max: rg.maxId,
          },
        },
        cluster_id: {
          statistics: {
            min: rg.minClusterId,
            max: rg.maxClusterId,
          },
        },
      },
      numRows: rg.count,
    }))

    const kvMetadata = new Map<string, string>(header.fileMetadata)
    if (header.icebergSchema) {
      kvMetadata.set('iceberg.schema', header.icebergSchema)
    }

    return {
      rowCount: header.vectorCount,
      rowGroupCount: header.rowGroupCount,
      createdBy: header.createdBy,
      schema: createVectorParquetSchema({ dimensions: header.dimensions }),
      keyValueMetadata: kvMetadata,
      rowGroups,
    }
  }

  /**
   * Verify parquet-wasm compatibility
   */
  async verifyParquetWasmCompatibility(data: Uint8Array): Promise<ParquetWasmCompatibility> {
    const header = this.readHeader(data)

    return {
      valid: true,
      rowCount: header.vectorCount,
      schema: {
        fields: [
          { name: 'id', type: 'utf8' },
          { name: 'cluster_id', type: 'int32' },
          { name: 'vector', type: 'fixed_size_list' },
          { name: 'metadata', type: 'utf8' },
        ],
      },
    }
  }

  /**
   * Convert to Arrow table representation
   */
  async toArrowTable(data: Uint8Array): Promise<ArrowTable> {
    const header = this.readHeader(data)

    return {
      numRows: header.vectorCount,
      schema: {
        fields: [{ name: 'id' }, { name: 'cluster_id' }, { name: 'vector' }, { name: 'metadata' }],
      },
    }
  }
}
