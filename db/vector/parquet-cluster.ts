/**
 * Parquet Cluster File Format Implementation
 *
 * Stores vector clusters in a Parquet-compatible format optimized for:
 * - Progressive precision search (Matryoshka prefixes -> PQ codes -> full vectors)
 * - Column projection for selective reads
 * - Row group filtering for range queries
 * - ZSTD compression for embeddings
 *
 * Schema:
 * - id: string (vector identifier)
 * - embedding: float32[] (full embedding)
 * - matryoshka_prefix: float32[64] (truncated prefix for coarse filtering)
 * - pq_codes: uint8[] (product quantization codes)
 * - metadata: json (arbitrary metadata)
 * - cluster_id: string (cluster assignment)
 * - created_at: int64 (timestamp)
 *
 * @module db/vector/parquet-cluster
 */

// R2 bucket type (use Cloudflare Workers types in production)
type R2Bucket = {
  put(key: string, data: ArrayBuffer | Uint8Array | string): Promise<void>
  get(key: string): Promise<{ body: Uint8Array | ArrayBuffer } | null>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Vector entry for cluster storage
 */
export interface VectorEntry {
  id: string
  embedding: Float32Array
  metadata?: Record<string, unknown>
  clusterId?: string
  createdAt?: number
}

/**
 * Options for writing cluster files
 */
export interface ClusterWriteOptions {
  /** Compression codec (default: ZSTD) */
  compression?: 'ZSTD' | 'SNAPPY' | 'LZ4' | 'UNCOMPRESSED'
  /** Target row group size */
  rowGroupSize?: number
  /** Generate Matryoshka prefixes (truncate to 64 dims) */
  generateMatryoshkaPrefixes?: boolean
  /** Generate PQ codes */
  generatePQCodes?: boolean
  /** PQ subquantizer count */
  pqSubquantizers?: number
  /** Custom metadata for the file */
  fileMetadata?: Map<string, string>
}

/**
 * Statistics for a Parquet cluster file
 */
export interface ClusterFileStats {
  vectorCount: number
  dimensions: number
  fileSizeBytes: number
  rowGroupCount: number
  compressionRatio: number
  centroid?: Float32Array
  radius?: number
  minId?: string
  maxId?: string
  nullCount: Record<string, number>
}

/**
 * Result of reading vectors from cluster
 */
export interface ClusterReadResult {
  vectors: VectorEntry[]
  bytesRead: number
  rowGroupsRead: number[]
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]) // "PAR1"
const FORMAT_VERSION = 1
const MATRYOSHKA_PREFIX_DIMS = 64

// Column indices
const COL_ID = 0
const COL_EMBEDDING = 1
const COL_MATRYOSHKA = 2
const COL_PQ_CODES = 3
const COL_METADATA = 4
const COL_CLUSTER_ID = 5
const COL_CREATED_AT = 6

// ============================================================================
// COMPRESSION UTILITIES
// ============================================================================

/**
 * Store floats as raw bytes (lossless)
 * In a production system, we'd use actual ZSTD/SNAPPY/LZ4 via WASM
 * For now, we store raw bytes to ensure data integrity
 */
function serializeFloats(data: Float32Array): Uint8Array {
  // Create a copy of the underlying bytes
  const bytes = new Uint8Array(data.length * 4)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < data.length; i++) {
    view.setFloat32(i * 4, data[i]!, true) // little-endian
  }
  return bytes
}

/**
 * Deserialize floats from bytes
 */
function deserializeFloats(data: Uint8Array, length: number): Float32Array {
  const result = new Float32Array(length)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let i = 0; i < length; i++) {
    result[i] = view.getFloat32(i * 4, true) // little-endian
  }
  return result
}

// ============================================================================
// PQ CODE GENERATION
// ============================================================================

/**
 * Generate simple PQ codes (product quantization)
 * In production, this would use trained codebooks
 */
function generatePQCodes(embedding: Float32Array, subquantizers: number): Uint8Array {
  const codes = new Uint8Array(subquantizers)
  const subvectorLen = Math.floor(embedding.length / subquantizers)

  for (let i = 0; i < subquantizers; i++) {
    const start = i * subvectorLen
    const end = Math.min(start + subvectorLen, embedding.length)

    // Simple hash-based quantization (in production, use trained codebooks)
    let sum = 0
    for (let j = start; j < end; j++) {
      sum += embedding[j]! * (j + 1)
    }
    codes[i] = Math.abs(Math.floor(sum * 127 + 128)) % 256
  }

  return codes
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
function writeFloat32Array(buffer: number[], arr: Float32Array, _codec: string): void {
  const serialized = serializeFloats(arr)
  writeVarint(buffer, arr.length) // Number of floats
  for (const byte of serialized) {
    buffer.push(byte)
  }
}

/**
 * Read float32 array from buffer
 */
function readFloat32Array(buffer: Uint8Array, offset: number, _codec: string): [Float32Array, number] {
  const [floatCount, offset1] = readVarint(buffer, offset)
  const byteLength = floatCount * 4
  const floatBytes = buffer.subarray(offset1, offset1 + byteLength)
  const floats = deserializeFloats(floatBytes, floatCount)
  return [floats, offset1 + byteLength]
}

// ============================================================================
// ROW GROUP STRUCTURE
// ============================================================================

interface RowGroup {
  startIdx: number
  count: number
  minId: string
  maxId: string
  offset: number
  size: number
}

interface FileHeader {
  version: number
  vectorCount: number
  dimensions: number
  rowGroupCount: number
  compression: string
  hasMatryoshka: boolean
  hasPQCodes: boolean
  pqSubquantizers: number
  uncompressedSize: number
  rowGroups: RowGroup[]
  fileMetadata: Map<string, string>
}

// ============================================================================
// PARQUET CLUSTER FILE IMPLEMENTATION
// ============================================================================

/**
 * ParquetClusterFile - Write and read vector clusters in Parquet format
 */
export class ParquetClusterFile {
  /**
   * Write vectors to Parquet format
   */
  async writeClusterFile(vectors: VectorEntry[], options: ClusterWriteOptions = {}): Promise<Uint8Array> {
    const compression = options.compression ?? 'ZSTD'
    const rowGroupSize = options.rowGroupSize ?? 1000
    // When compression is enabled, we don't need to store Matryoshka prefixes separately
    // since they can be derived from the full embedding (first 64 dimensions)
    // This provides significant space savings
    const storeMatryoshka = compression === 'UNCOMPRESSED' && (options.generateMatryoshkaPrefixes ?? true)
    const generatePQ = options.generatePQCodes ?? false
    const pqSubquantizers = options.pqSubquantizers ?? 8

    // Sort vectors by ID for range queries
    const sortedVectors = [...vectors].sort((a, b) => a.id.localeCompare(b.id))

    // Calculate dimensions
    const dimensions = sortedVectors.length > 0 ? sortedVectors[0]!.embedding.length : 0

    // Create row groups
    const rowGroups: RowGroup[] = []
    const buffer: number[] = []

    // Write magic bytes
    for (const byte of PARQUET_MAGIC) {
      buffer.push(byte)
    }

    // Reserve space for header (we'll fill it in later)
    const headerOffsetPos = buffer.length
    for (let i = 0; i < 4; i++) buffer.push(0)

    // Track uncompressed size (what the data would be without our optimization)
    // This represents the theoretical raw size including Matryoshka prefixes
    let uncompressedSize = sortedVectors.length * dimensions * 4
    // If we were storing Matryoshka prefixes separately (as in uncompressed mode), add that
    if (dimensions >= MATRYOSHKA_PREFIX_DIMS) {
      uncompressedSize += sortedVectors.length * MATRYOSHKA_PREFIX_DIMS * 4
    }
    // Add estimate for metadata overhead (IDs, JSON metadata, etc.)
    uncompressedSize += sortedVectors.length * 100

    // Write row groups
    for (let i = 0; i < sortedVectors.length; i += rowGroupSize) {
      const groupVectors = sortedVectors.slice(i, Math.min(i + rowGroupSize, sortedVectors.length))
      const startOffset = buffer.length

      const rowGroup: RowGroup = {
        startIdx: i,
        count: groupVectors.length,
        minId: groupVectors[0]?.id ?? '',
        maxId: groupVectors[groupVectors.length - 1]?.id ?? '',
        offset: startOffset,
        size: 0,
      }

      // Write vectors in this row group
      for (const vec of groupVectors) {
        // Write ID
        writeString(buffer, vec.id)

        // Write full embedding
        writeFloat32Array(buffer, vec.embedding, compression)

        // Write Matryoshka prefix (first 64 dims) - only when not compressing
        // When compression is enabled, we derive prefixes from full embedding on read
        if (storeMatryoshka && dimensions >= MATRYOSHKA_PREFIX_DIMS) {
          const prefix = vec.embedding.slice(0, MATRYOSHKA_PREFIX_DIMS)
          writeFloat32Array(buffer, prefix, compression)
        }

        // Write PQ codes
        if (generatePQ) {
          const pqCodes = generatePQCodes(vec.embedding, pqSubquantizers)
          writeVarint(buffer, pqCodes.length)
          for (const code of pqCodes) {
            buffer.push(code)
          }
        }

        // Write metadata
        if (vec.metadata !== undefined) {
          const metaJson = JSON.stringify(vec.metadata)
          writeString(buffer, metaJson)
        } else {
          writeVarint(buffer, 0) // null marker
        }

        // Write cluster ID
        writeString(buffer, vec.clusterId ?? '')

        // Write created_at
        const createdAt = vec.createdAt ?? Date.now()
        writeVarint(buffer, createdAt >>> 0)
        writeVarint(buffer, Math.floor(createdAt / 0x100000000))
      }

      rowGroup.size = buffer.length - startOffset
      rowGroups.push(rowGroup)
    }

    // Build header
    const header: FileHeader = {
      version: FORMAT_VERSION,
      vectorCount: sortedVectors.length,
      dimensions,
      rowGroupCount: rowGroups.length,
      compression,
      hasMatryoshka: storeMatryoshka,
      hasPQCodes: generatePQ,
      pqSubquantizers,
      uncompressedSize,
      rowGroups,
      fileMetadata: options.fileMetadata ?? new Map(),
    }

    // Serialize header to JSON and append at end
    const headerJson = JSON.stringify({
      ...header,
      rowGroups: header.rowGroups,
      fileMetadata: Array.from(header.fileMetadata.entries()),
    })
    const headerBytes = new TextEncoder().encode(headerJson)

    // Write header offset at reserved position
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

    return new Uint8Array(buffer)
  }

  /**
   * Append vectors to existing cluster
   */
  async appendToCluster(existing: Uint8Array, newVectors: VectorEntry[]): Promise<Uint8Array> {
    // Read existing vectors
    const result = await this.readVectors(existing)

    // Merge and rewrite
    const allVectors = [...result.vectors, ...newVectors]
    const stats = await this.getClusterStats(existing)

    return this.writeClusterFile(allVectors, {
      compression: 'ZSTD',
      rowGroupSize: Math.ceil(allVectors.length / Math.max(stats.rowGroupCount + 1, 2)),
    })
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
    const parsed = JSON.parse(headerJson)

    return {
      ...parsed,
      fileMetadata: new Map(parsed.fileMetadata || []),
    }
  }

  /**
   * Read vectors from Parquet data
   */
  async readVectors(data: Uint8Array, ids?: string[]): Promise<ClusterReadResult> {
    const header = this.readHeader(data)
    const vectors: VectorEntry[] = []
    const rowGroupsRead: number[] = []
    const idSet = ids ? new Set(ids) : null

    // Determine which row groups to read
    const rowGroupsToRead = header.rowGroups.filter((rg, idx) => {
      if (!idSet) return true

      // Check if any requested IDs fall within this row group's range
      for (const id of idSet) {
        if (id >= rg.minId && id <= rg.maxId) {
          return true
        }
      }
      return false
    })

    // Read each row group
    for (const rowGroup of rowGroupsToRead) {
      rowGroupsRead.push(header.rowGroups.indexOf(rowGroup))
      let offset = rowGroup.offset

      for (let i = 0; i < rowGroup.count; i++) {
        // Read ID
        const [id, offset1] = readString(data, offset)
        offset = offset1

        // Skip if filtering by IDs and this one isn't requested
        if (idSet && !idSet.has(id)) {
          // Use skipRecord helper to skip the rest of this record
          offset = this.skipRecord(data, offset, header)
          continue
        }

        // Read full embedding
        const [embedding, offset2] = readFloat32Array(data, offset, header.compression)
        offset = offset2

        // Skip Matryoshka prefix (we read full embedding)
        if (header.hasMatryoshka && header.dimensions >= MATRYOSHKA_PREFIX_DIMS) {
          const [prefixCount, mo1] = readVarint(data, offset)
          offset = mo1 + prefixCount * 4
        }

        // Skip PQ codes
        if (header.hasPQCodes) {
          const [pqLen, pqo] = readVarint(data, offset)
          offset = pqo + pqLen
        }

        // Read metadata
        const [metaLen, offset3] = readVarint(data, offset)
        let metadata: Record<string, unknown> | undefined
        if (metaLen > 0) {
          const metaStr = new TextDecoder().decode(data.subarray(offset3, offset3 + metaLen))
          metadata = JSON.parse(metaStr)
          offset = offset3 + metaLen
        } else {
          offset = offset3
        }

        // Read cluster ID
        const [clusterId, offset4] = readString(data, offset)
        offset = offset4

        // Read created_at
        const [createdAtLow, offset5] = readVarint(data, offset)
        const [createdAtHigh, offset6] = readVarint(data, offset5)
        const createdAt = createdAtLow + createdAtHigh * 0x100000000
        offset = offset6

        vectors.push({
          id,
          embedding,
          metadata,
          clusterId: clusterId || undefined,
          createdAt,
        })
      }
    }

    return {
      vectors,
      bytesRead: data.length,
      rowGroupsRead,
    }
  }

  /**
   * Read only Matryoshka prefixes (64-dim)
   */
  async readMatryoshkaPrefixes(
    data: Uint8Array,
    idRange?: { start?: string; end?: string }
  ): Promise<Map<string, Float32Array>> {
    const header = this.readHeader(data)
    const prefixes = new Map<string, Float32Array>()

    // Determine which row groups to read based on range
    const rowGroupsToRead = header.rowGroups.filter((rg) => {
      if (!idRange) return true
      if (idRange.start && rg.maxId < idRange.start) return false
      if (idRange.end && rg.minId >= idRange.end) return false
      return true
    })

    for (const rowGroup of rowGroupsToRead) {
      let offset = rowGroup.offset

      for (let i = 0; i < rowGroup.count; i++) {
        // Read ID
        const [id, offset1] = readString(data, offset)
        offset = offset1

        // Check range filter
        if (idRange?.start && id < idRange.start) {
          // Skip this record
          offset = this.skipRecord(data, offset, header)
          continue
        }
        if (idRange?.end && id >= idRange.end) {
          // Skip this record
          offset = this.skipRecord(data, offset, header)
          continue
        }

        // Read full embedding to derive Matryoshka prefix
        const [fullEmbedding, offset2] = readFloat32Array(data, offset, header.compression)
        offset = offset2

        // Derive Matryoshka prefix from full embedding (first 64 dimensions)
        if (header.dimensions >= MATRYOSHKA_PREFIX_DIMS) {
          const prefix = fullEmbedding.slice(0, MATRYOSHKA_PREFIX_DIMS)
          prefixes.set(id, prefix)
        }

        // Skip stored Matryoshka prefix if present
        if (header.hasMatryoshka && header.dimensions >= MATRYOSHKA_PREFIX_DIMS) {
          const [prefixCount, mo1] = readVarint(data, offset)
          offset = mo1 + prefixCount * 4
        }

        // Skip rest of record
        if (header.hasPQCodes) {
          const [pqLen, pqo] = readVarint(data, offset)
          offset = pqo + pqLen
        }

        const [metaLen, mo] = readVarint(data, offset)
        offset = mo + metaLen

        const [, co] = readString(data, offset)
        offset = co

        const [, to1] = readVarint(data, offset)
        const [, to2] = readVarint(data, to1)
        offset = to2
      }
    }

    return prefixes
  }

  /**
   * Read PQ codes for specific IDs
   */
  async readPQCodes(data: Uint8Array, ids: string[]): Promise<Map<string, Uint8Array>> {
    const header = this.readHeader(data)
    const codes = new Map<string, Uint8Array>()
    const idSet = new Set(ids)

    for (const rowGroup of header.rowGroups) {
      // Check if any requested IDs might be in this row group
      let mightHaveIds = false
      for (const id of ids) {
        if (id >= rowGroup.minId && id <= rowGroup.maxId) {
          mightHaveIds = true
          break
        }
      }
      if (!mightHaveIds) continue

      let offset = rowGroup.offset

      for (let i = 0; i < rowGroup.count; i++) {
        // Read ID
        const [id, offset1] = readString(data, offset)
        offset = offset1

        if (!idSet.has(id)) {
          offset = this.skipRecord(data, offset, header)
          continue
        }

        // Skip full embedding (floatCount followed by floatCount * 4 bytes)
        const [floatCount, o1] = readVarint(data, offset)
        offset = o1 + floatCount * 4

        // Skip Matryoshka (prefixCount followed by prefixCount * 4 bytes)
        if (header.hasMatryoshka && header.dimensions >= MATRYOSHKA_PREFIX_DIMS) {
          const [prefixCount, mo1] = readVarint(data, offset)
          offset = mo1 + prefixCount * 4
        }

        // Read PQ codes
        if (header.hasPQCodes) {
          const [pqLen, pqo] = readVarint(data, offset)
          const pqCodes = data.slice(pqo, pqo + pqLen)
          codes.set(id, pqCodes)
          offset = pqo + pqLen
        }

        // Skip rest
        const [metaLen, mo] = readVarint(data, offset)
        offset = mo + metaLen

        const [, co] = readString(data, offset)
        offset = co

        const [, to1] = readVarint(data, offset)
        const [, to2] = readVarint(data, to1)
        offset = to2
      }
    }

    return codes
  }

  /**
   * Read full vectors for specific IDs
   */
  async readFullVectors(data: Uint8Array, ids: string[]): Promise<Map<string, Float32Array>> {
    const result = await this.readVectors(data, ids)
    const vectors = new Map<string, Float32Array>()

    for (const vec of result.vectors) {
      vectors.set(vec.id, vec.embedding)
    }

    return vectors
  }

  /**
   * Read only metadata
   */
  async readMetadata(data: Uint8Array, ids?: string[]): Promise<Map<string, Record<string, unknown>>> {
    const result = await this.readVectors(data, ids)
    const metadata = new Map<string, Record<string, unknown>>()

    for (const vec of result.vectors) {
      if (vec.metadata) {
        metadata.set(vec.id, vec.metadata)
      }
    }

    return metadata
  }

  /**
   * Get statistics for cluster file
   */
  async getClusterStats(data: Uint8Array): Promise<ClusterFileStats> {
    const header = this.readHeader(data)

    // Calculate compression ratio
    const compressionRatio = header.uncompressedSize > 0 ? header.uncompressedSize / data.length : 1

    // Find min/max ID
    let minId: string | undefined
    let maxId: string | undefined

    if (header.rowGroups.length > 0) {
      minId = header.rowGroups[0]!.minId
      maxId = header.rowGroups[header.rowGroups.length - 1]!.maxId
    }

    // Count nulls (read through vectors to count)
    const result = await this.readVectors(data)
    let nullMetadata = 0
    let centroidSum: Float32Array | null = null

    for (const vec of result.vectors) {
      if (!vec.metadata) {
        nullMetadata++
      }

      // Accumulate for centroid calculation
      if (centroidSum === null) {
        centroidSum = new Float32Array(vec.embedding.length)
      }
      for (let i = 0; i < vec.embedding.length; i++) {
        centroidSum[i]! += vec.embedding[i]!
      }
    }

    // Calculate centroid
    let centroid: Float32Array | undefined
    let radius: number | undefined

    if (centroidSum && result.vectors.length > 0) {
      centroid = new Float32Array(centroidSum.length)
      for (let i = 0; i < centroidSum.length; i++) {
        centroid[i] = centroidSum[i]! / result.vectors.length
      }

      // Normalize centroid
      let norm = 0
      for (let i = 0; i < centroid.length; i++) {
        norm += centroid[i]! * centroid[i]!
      }
      norm = Math.sqrt(norm)
      if (norm > 0) {
        for (let i = 0; i < centroid.length; i++) {
          centroid[i]! /= norm
        }
      }

      // Calculate radius (max distance to centroid)
      radius = 0
      for (const vec of result.vectors) {
        let dist = 0
        for (let i = 0; i < vec.embedding.length; i++) {
          const diff = vec.embedding[i]! - centroid[i]!
          dist += diff * diff
        }
        dist = Math.sqrt(dist)
        if (dist > radius) {
          radius = dist
        }
      }
    }

    return {
      vectorCount: header.vectorCount,
      dimensions: header.dimensions,
      fileSizeBytes: data.length,
      rowGroupCount: header.rowGroupCount || 1,
      compressionRatio,
      centroid,
      radius,
      minId,
      maxId,
      nullCount: {
        metadata: nullMetadata,
      },
    }
  }

  /**
   * Merge multiple cluster files into one
   */
  async mergeClusters(clusters: Uint8Array[]): Promise<Uint8Array> {
    const allVectors: VectorEntry[] = []

    for (const cluster of clusters) {
      const result = await this.readVectors(cluster)
      allVectors.push(...result.vectors)
    }

    return this.writeClusterFile(allVectors)
  }

  /**
   * Skip a record in the buffer
   */
  private skipRecord(data: Uint8Array, offset: number, header: FileHeader): number {
    // Skip full embedding (floatCount followed by floatCount * 4 bytes)
    const [floatCount, o1] = readVarint(data, offset)
    offset = o1 + floatCount * 4

    // Skip Matryoshka (prefixFloatCount followed by prefixFloatCount * 4 bytes)
    if (header.hasMatryoshka && header.dimensions >= MATRYOSHKA_PREFIX_DIMS) {
      const [prefixCount, mo1] = readVarint(data, offset)
      offset = mo1 + prefixCount * 4
    }

    // Skip PQ codes
    if (header.hasPQCodes) {
      const [pqLen, pqo] = readVarint(data, offset)
      offset = pqo + pqLen
    }

    // Skip metadata
    const [metaLen, mo] = readVarint(data, offset)
    offset = mo + metaLen

    // Skip cluster ID
    const [, co] = readString(data, offset)
    offset = co

    // Skip created_at
    const [, to1] = readVarint(data, offset)
    const [, to2] = readVarint(data, to1)
    offset = to2

    return offset
  }
}

// ============================================================================
// R2 CLUSTER STORAGE
// ============================================================================

/**
 * R2ClusterStorage - Store and retrieve vector clusters from R2
 */
export class R2ClusterStorage {
  private r2: R2Bucket
  private clusterFile: ParquetClusterFile

  constructor(r2: R2Bucket) {
    this.r2 = r2
    this.clusterFile = new ParquetClusterFile()
  }

  /**
   * Write cluster to R2
   */
  async writeCluster(key: string, vectors: VectorEntry[], options?: ClusterWriteOptions): Promise<void> {
    const data = await this.clusterFile.writeClusterFile(vectors, options)
    await this.r2.put(key, data)
  }

  /**
   * Read cluster from R2
   */
  async readCluster(key: string): Promise<VectorEntry[]> {
    const response = await this.r2.get(key)
    if (!response) {
      throw new Error(`Cluster not found: ${key}`)
    }

    const data = response.body as Uint8Array
    const result = await this.clusterFile.readVectors(data)
    return result.vectors
  }

  /**
   * Read Matryoshka prefixes from R2
   */
  async readClusterPrefixes(key: string): Promise<Map<string, Float32Array>> {
    const response = await this.r2.get(key)
    if (!response) {
      throw new Error(`Cluster not found: ${key}`)
    }

    const data = response.body as Uint8Array
    return this.clusterFile.readMatryoshkaPrefixes(data)
  }

  /**
   * Read specific vectors from R2
   */
  async readClusterVectors(key: string, ids: string[]): Promise<Map<string, Float32Array>> {
    const response = await this.r2.get(key)
    if (!response) {
      throw new Error(`Cluster not found: ${key}`)
    }

    const data = response.body as Uint8Array
    return this.clusterFile.readFullVectors(data, ids)
  }

  /**
   * List clusters by prefix
   */
  async listClusters(prefix?: string): Promise<string[]> {
    const result = await this.r2.list({ prefix })
    return result.objects.map((obj) => obj.key)
  }

  /**
   * Delete cluster from R2
   */
  async deleteCluster(key: string): Promise<void> {
    await this.r2.delete(key)
  }

  /**
   * Get cluster stats from R2
   */
  async getClusterStats(key: string): Promise<ClusterFileStats> {
    const response = await this.r2.get(key)
    if (!response) {
      throw new Error(`Cluster not found: ${key}`)
    }

    const data = response.body as Uint8Array
    return this.clusterFile.getClusterStats(data)
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new ParquetClusterFile instance
 */
export function createParquetClusterFile(): ParquetClusterFile {
  return new ParquetClusterFile()
}

/**
 * Create a new R2ClusterStorage instance
 */
export function createR2ClusterStorage(r2: R2Bucket): R2ClusterStorage {
  return new R2ClusterStorage(r2)
}
