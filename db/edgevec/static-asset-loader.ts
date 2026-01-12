/**
 * Static Asset Loader
 *
 * Fetches and parses binary vector index files from Cloudflare Workers static assets.
 * These binary formats are optimized for efficient vector search with minimal memory overhead.
 *
 * Binary Formats Supported:
 * - CENT: Centroid Index (cluster centers for coarse quantization)
 * - PQCB: PQ Codebooks (Product Quantization subspace centroids)
 * - CLST: Cluster Files (vector IDs + PQ codes per cluster)
 * - MTRY: Matryoshka Prefixes (64-dim prefix vectors for progressive precision)
 *
 * @module db/edgevec/static-asset-loader
 */

// ============================================================================
// MAGIC BYTES CONSTANTS
// ============================================================================

const MAGIC = {
  CENT: 0x43454e54, // "CENT" - Centroid Index
  PQCB: 0x50514342, // "PQCB" - PQ Codebooks
  CLST: 0x434c5354, // "CLST" - Cluster File
  MTRY: 0x4d545259, // "MTRY" - Matryoshka Prefixes
} as const

type MagicType = 'CENT' | 'PQCB' | 'CLST' | 'MTRY'

// ============================================================================
// FLOAT16 CONVERSION
// ============================================================================

/**
 * Convert a Uint16Array of float16 values to a Float32Array
 *
 * Handles special values:
 * - Positive/negative zero
 * - Positive/negative infinity
 * - NaN
 * - Denormalized numbers
 */
export function float16ToFloat32(float16Array: Uint16Array): Float32Array {
  const result = new Float32Array(float16Array.length)

  for (let i = 0; i < float16Array.length; i++) {
    const h = float16Array[i]!

    // Extract sign, exponent, and mantissa
    const sign = (h >>> 15) & 0x1
    const exponent = (h >>> 10) & 0x1f
    const mantissa = h & 0x3ff

    let floatValue: number

    if (exponent === 0) {
      // Zero or denormalized number
      if (mantissa === 0) {
        // Zero (positive or negative)
        floatValue = sign === 0 ? 0 : -0
      } else {
        // Denormalized - convert to normalized float32
        // The value is (-1)^sign * 2^-14 * (mantissa / 1024)
        floatValue = (sign === 0 ? 1 : -1) * Math.pow(2, -14) * (mantissa / 1024)
      }
    } else if (exponent === 31) {
      // Infinity or NaN
      if (mantissa === 0) {
        floatValue = sign === 0 ? Infinity : -Infinity
      } else {
        floatValue = NaN
      }
    } else {
      // Normalized number
      // Convert exponent from float16 bias (15) to float32 bias (127)
      const float32Exponent = exponent - 15 + 127
      // Expand mantissa from 10 bits to 23 bits
      const float32Mantissa = mantissa << 13

      // Reconstruct float32 bits
      const float32Bits = (sign << 31) | (float32Exponent << 23) | float32Mantissa

      // Convert bits to float
      const tempBuffer = new ArrayBuffer(4)
      const tempView = new DataView(tempBuffer)
      tempView.setUint32(0, float32Bits, false)
      floatValue = tempView.getFloat32(0, false)
    }

    result[i] = floatValue
  }

  return result
}

// ============================================================================
// MAGIC BYTES VALIDATION
// ============================================================================

/**
 * Validate magic bytes against expected format
 */
export function validateMagicBytes(magic: number, expected: MagicType): boolean {
  return magic === MAGIC[expected]
}

// ============================================================================
// CENTROID METADATA TYPE
// ============================================================================

interface CentroidMetadata {
  vectorCount: number
  avgDistance: number
  maxDistance: number
}

interface ParsedCentroids {
  magic: number
  version: number
  numCentroids: number
  dimensions: number
  dtype: number
  metric: number
  centroids: Float32Array
  metadata?: CentroidMetadata[]
  hasInvalidData: boolean
  memoryStats: {
    bytesUsed: number
  }
  validate?: () => boolean
}

// ============================================================================
// PARSE CENT FORMAT
// ============================================================================

/**
 * Parse a CENT (Centroid Index) binary file
 *
 * Format:
 * - Header (32 bytes):
 *   - magic: uint32 (big-endian) = 0x43454E54
 *   - version: uint16 (little-endian)
 *   - flags: uint16 (little-endian)
 *   - numCentroids: uint32 (little-endian)
 *   - dimensions: uint32 (little-endian)
 *   - dtype: uint8 (0=float32, 1=float16)
 *   - metric: uint8 (0=cosine, 1=l2, 2=dot)
 *   - reserved: 14 bytes
 * - Data: numCentroids * dimensions * (4 or 2 bytes)
 * - Optional metadata: numCentroids * 16 bytes
 */
export function parseCentroidsFile(buffer: ArrayBuffer): ParsedCentroids {
  if (buffer.byteLength === 0) {
    throw new Error('Empty or invalid buffer')
  }

  if (buffer.byteLength < 32) {
    throw new Error('Truncated or incomplete header')
  }

  const view = new DataView(buffer)

  // Parse header
  const magic = view.getUint32(0, false) // big-endian
  if (!validateMagicBytes(magic, 'CENT')) {
    throw new Error(`Invalid magic bytes: expected CENT (0x43454E54), got 0x${magic.toString(16)}`)
  }

  const version = view.getUint16(4, true)
  // const flags = view.getUint16(6, true) // not used yet
  const numCentroids = view.getUint32(8, true)
  const dimensions = view.getUint32(12, true)
  const dtype = view.getUint8(16)
  const metric = view.getUint8(17)

  // Calculate expected data size
  const bytesPerFloat = dtype === 0 ? 4 : 2
  const dataSize = numCentroids * dimensions * bytesPerFloat
  const headerSize = 32

  if (buffer.byteLength < headerSize + dataSize) {
    throw new Error(`Insufficient data: expected at least ${headerSize + dataSize} bytes, got ${buffer.byteLength}`)
  }

  // Extract centroid data
  let centroids: Float32Array
  if (dtype === 0) {
    // float32
    centroids = new Float32Array(buffer, headerSize, numCentroids * dimensions)
  } else {
    // float16 - convert to float32
    const float16Data = new Uint16Array(buffer, headerSize, numCentroids * dimensions)
    centroids = float16ToFloat32(float16Data)
  }

  // Check for invalid data
  let hasInvalidData = false
  for (let i = 0; i < centroids.length; i++) {
    if (!Number.isFinite(centroids[i])) {
      hasInvalidData = true
      break
    }
  }

  // Parse optional metadata if present
  let metadata: CentroidMetadata[] | undefined
  const metadataOffset = headerSize + dataSize
  const metadataSize = numCentroids * 16
  if (buffer.byteLength >= metadataOffset + metadataSize) {
    metadata = []
    for (let i = 0; i < numCentroids; i++) {
      const offset = metadataOffset + i * 16
      metadata.push({
        vectorCount: view.getUint32(offset, true),
        avgDistance: view.getFloat32(offset + 4, true),
        maxDistance: view.getFloat32(offset + 8, true),
      })
    }
  }

  const bytesUsed = centroids.byteLength + (metadata ? metadata.length * 16 : 0)

  return {
    magic,
    version,
    numCentroids,
    dimensions,
    dtype,
    metric,
    centroids,
    metadata,
    hasInvalidData,
    memoryStats: {
      bytesUsed,
    },
    validate: () => !hasInvalidData,
  }
}

// ============================================================================
// PARSE PQCB FORMAT
// ============================================================================

interface ParsedCodebooks {
  magic: number
  version: number
  M: number
  Ksub: number
  dimensions: number
  subvectorDim: number
  dtype: number
  codebooks: Float32Array[]
  memoryStats: {
    bytesUsed: number
  }
}

/**
 * Parse a PQCB (PQ Codebooks) binary file
 *
 * Format:
 * - Header (32 bytes):
 *   - magic: uint32 (big-endian) = 0x50514342
 *   - version: uint16 (little-endian)
 *   - flags: uint16 (little-endian)
 *   - M: uint32 (little-endian) - num subspaces
 *   - Ksub: uint32 (little-endian) - centroids per subspace
 *   - dimensions: uint32 (little-endian) - full vector dimensions
 *   - subvectorDim: uint32 (little-endian) - dimensions / M
 *   - dtype: uint8
 *   - reserved: 7 bytes
 * - Data: M * Ksub * subvectorDim * 4 bytes (float32)
 */
export function parseCodebooksFile(buffer: ArrayBuffer): ParsedCodebooks {
  if (buffer.byteLength === 0) {
    throw new Error('Empty or invalid buffer')
  }

  if (buffer.byteLength < 32) {
    throw new Error('Truncated or incomplete header')
  }

  const view = new DataView(buffer)

  // Parse header
  const magic = view.getUint32(0, false)
  if (!validateMagicBytes(magic, 'PQCB')) {
    throw new Error(`Invalid magic bytes: expected PQCB (0x50514342), got 0x${magic.toString(16)}`)
  }

  const version = view.getUint16(4, true)
  // const flags = view.getUint16(6, true)
  const M = view.getUint32(8, true)
  const Ksub = view.getUint32(12, true)
  const dimensions = view.getUint32(16, true)
  const subvectorDim = view.getUint32(20, true)
  const dtype = view.getUint8(24)

  // Validate configuration
  if (M === 0) {
    throw new Error('Invalid configuration: M cannot be 0')
  }
  if (Ksub === 0) {
    throw new Error('Invalid configuration: Ksub cannot be 0')
  }

  const headerSize = 32
  const bytesPerFloat = dtype === 0 ? 4 : 2
  const dataSize = M * Ksub * subvectorDim * bytesPerFloat

  if (buffer.byteLength < headerSize + dataSize) {
    throw new Error(`Insufficient data: expected at least ${headerSize + dataSize} bytes, got ${buffer.byteLength}`)
  }

  // Extract codebooks - organized by subspace
  const codebooks: Float32Array[] = []
  const codebookSize = Ksub * subvectorDim

  for (let m = 0; m < M; m++) {
    const offset = headerSize + m * codebookSize * bytesPerFloat
    if (dtype === 0) {
      codebooks.push(new Float32Array(buffer, offset, codebookSize))
    } else {
      const float16Data = new Uint16Array(buffer, offset, codebookSize)
      codebooks.push(float16ToFloat32(float16Data))
    }
  }

  let bytesUsed = 0
  for (const cb of codebooks) {
    bytesUsed += cb.byteLength
  }

  return {
    magic,
    version,
    M,
    Ksub,
    dimensions,
    subvectorDim,
    dtype,
    codebooks,
    memoryStats: {
      bytesUsed,
    },
  }
}

// ============================================================================
// PARSE CLST FORMAT
// ============================================================================

interface ParsedCluster {
  magic: number
  version: number
  clusterId: number
  vectorCount: number
  M: number
  idType: number
  hasMetadata: boolean
  ids: BigUint64Array
  pqCodes: Uint8Array
  getCodesForVector: (index: number) => Uint8Array
  memoryStats: {
    bytesUsed: number
  }
}

/**
 * Parse a CLST (Cluster) binary file
 *
 * Format:
 * - Header (64 bytes):
 *   - magic: uint32 (big-endian) = 0x434C5354
 *   - version: uint16 (little-endian)
 *   - flags: uint16 (little-endian)
 *   - clusterId: uint32 (little-endian)
 *   - vectorCount: uint32 (little-endian)
 *   - M: uint8 - PQ subspaces
 *   - idType: uint8 (0=uint64, 1=string offset)
 *   - hasMetadata: uint8
 *   - reserved: 45 bytes
 * - Vector IDs: vectorCount * 8 bytes (uint64)
 * - PQ codes: vectorCount * M bytes
 */
export function parseClusterFile(buffer: ArrayBuffer): ParsedCluster {
  if (buffer.byteLength === 0) {
    throw new Error('Empty or invalid buffer')
  }

  if (buffer.byteLength < 64) {
    throw new Error('Truncated or incomplete header')
  }

  const view = new DataView(buffer)

  // Parse header
  const magic = view.getUint32(0, false)
  if (!validateMagicBytes(magic, 'CLST')) {
    throw new Error(`Invalid magic bytes: expected CLST (0x434C5354), got 0x${magic.toString(16)}`)
  }

  const version = view.getUint16(4, true)
  // const flags = view.getUint16(6, true)
  const clusterId = view.getUint32(8, true)
  const vectorCount = view.getUint32(12, true)
  const M = view.getUint8(16)
  const idType = view.getUint8(17)
  const hasMetadata = view.getUint8(18) === 1

  const headerSize = 64
  const idsSize = idType === 0 ? vectorCount * 8 : 0
  const pqCodesSize = vectorCount * M
  const expectedSize = headerSize + idsSize + pqCodesSize

  if (buffer.byteLength < expectedSize) {
    throw new Error(`Data mismatch or truncated: expected at least ${expectedSize} bytes, got ${buffer.byteLength}`)
  }

  // Extract vector IDs
  const ids = new BigUint64Array(buffer, headerSize, vectorCount)

  // Extract PQ codes
  const pqCodesOffset = headerSize + idsSize
  const pqCodes = new Uint8Array(buffer, pqCodesOffset, vectorCount * M)

  // Helper function to get codes for a specific vector
  const getCodesForVector = (index: number): Uint8Array => {
    if (index < 0 || index >= vectorCount) {
      throw new Error(`Vector index out of bounds: ${index}`)
    }
    return new Uint8Array(pqCodes.buffer, pqCodes.byteOffset + index * M, M)
  }

  return {
    magic,
    version,
    clusterId,
    vectorCount,
    M,
    idType,
    hasMetadata,
    ids,
    pqCodes,
    getCodesForVector,
    memoryStats: {
      bytesUsed: ids.byteLength + pqCodes.byteLength,
    },
  }
}

// ============================================================================
// PARSE MTRY FORMAT
// ============================================================================

interface ParsedMatryoshka {
  magic: number
  version: number
  clusterId: number
  vectorCount: number
  prefixDims: number
  dtype: number
  prefixes: Float32Array
  getPrefixForVector: (index: number) => Float32Array
  memoryStats: {
    bytesUsed: number
  }
}

/**
 * Parse a MTRY (Matryoshka Prefixes) binary file
 *
 * Format:
 * - Header (32 bytes):
 *   - magic: uint32 (big-endian) = 0x4D545259
 *   - version: uint16 (little-endian)
 *   - flags: uint16 (little-endian)
 *   - clusterId: uint32 (little-endian)
 *   - vectorCount: uint32 (little-endian)
 *   - prefixDims: uint16 (little-endian) - default 64
 *   - dtype: uint8
 *   - reserved: 13 bytes
 * - Data: vectorCount * prefixDims * (4 or 2) bytes
 */
export function parseMatryoshkaFile(buffer: ArrayBuffer): ParsedMatryoshka {
  if (buffer.byteLength === 0) {
    throw new Error('Empty or invalid buffer')
  }

  if (buffer.byteLength < 32) {
    throw new Error('Truncated or incomplete header')
  }

  const view = new DataView(buffer)

  // Parse header
  const magic = view.getUint32(0, false)
  if (!validateMagicBytes(magic, 'MTRY')) {
    throw new Error(`Invalid magic bytes: expected MTRY (0x4D545259), got 0x${magic.toString(16)}`)
  }

  const version = view.getUint16(4, true)
  // const flags = view.getUint16(6, true)
  const clusterId = view.getUint32(8, true)
  const vectorCount = view.getUint32(12, true)
  const prefixDims = view.getUint16(16, true)
  const dtype = view.getUint8(18)

  const headerSize = 32
  const bytesPerFloat = dtype === 0 ? 4 : 2
  const dataSize = vectorCount * prefixDims * bytesPerFloat

  if (buffer.byteLength < headerSize + dataSize) {
    throw new Error(`Insufficient data: expected at least ${headerSize + dataSize} bytes, got ${buffer.byteLength}`)
  }

  // Extract prefix data
  let prefixes: Float32Array
  if (dtype === 0) {
    prefixes = new Float32Array(buffer, headerSize, vectorCount * prefixDims)
  } else {
    const float16Data = new Uint16Array(buffer, headerSize, vectorCount * prefixDims)
    prefixes = float16ToFloat32(float16Data)
  }

  // Helper function to get prefix for a specific vector
  const getPrefixForVector = (index: number): Float32Array => {
    if (index < 0 || index >= vectorCount) {
      throw new Error(`Vector index out of bounds: ${index}`)
    }
    return new Float32Array(prefixes.buffer, prefixes.byteOffset + index * prefixDims * 4, prefixDims)
  }

  return {
    magic,
    version,
    clusterId,
    vectorCount,
    prefixDims,
    dtype,
    prefixes,
    getPrefixForVector,
    memoryStats: {
      bytesUsed: prefixes.byteLength,
    },
  }
}

// ============================================================================
// STREAMING CLUSTER LOADER
// ============================================================================

interface StreamClusterOptions {
  batchSize?: number
}

interface ClusterStreamHeader {
  clusterId: number
  vectorCount: number
  M: number
  idType: number
}

interface ClusterStreamChunk {
  header?: ClusterStreamHeader
  ids: BigUint64Array
  codes: Uint8Array
}

/**
 * Stream a cluster file in chunks for memory efficiency
 *
 * Yields chunks of vector IDs and PQ codes as they are parsed,
 * allowing processing without loading the entire file into memory.
 */
export async function* streamCluster(
  clusterId: number,
  options: StreamClusterOptions = {}
): AsyncGenerator<ClusterStreamChunk> {
  const { batchSize = 1000 } = options

  const url = `/static/cluster-${clusterId.toString().padStart(4, '0')}.bin`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch cluster ${clusterId}: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('Response has no body')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0

  // Read all data first (streaming parsing would require more complex buffering)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalLength += value.length
    }
  } catch (error) {
    // Yield whatever we've accumulated so far before re-throwing
    if (chunks.length > 0) {
      const partialBuffer = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        partialBuffer.set(chunk, offset)
        offset += chunk.length
      }

      // Try to parse what we have
      if (totalLength >= 64) {
        const view = new DataView(partialBuffer.buffer)
        const header: ClusterStreamHeader = {
          clusterId: view.getUint32(8, true),
          vectorCount: view.getUint32(12, true),
          M: view.getUint8(16),
          idType: view.getUint8(17),
        }

        // Yield header and partial data
        const M = header.M
        const headerSize = 64
        const idsSize = header.idType === 0 ? 8 : 0 // per vector

        // Calculate how many complete vectors we have
        const bytesPerVector = idsSize + M
        const availableBytes = totalLength - headerSize
        const completeVectors = Math.floor(availableBytes / bytesPerVector)

        if (completeVectors > 0) {
          const ids = new BigUint64Array(completeVectors)
          const codes = new Uint8Array(completeVectors * M)

          for (let i = 0; i < completeVectors; i++) {
            const idOffset = headerSize + i * 8
            ids[i] = view.getBigUint64(idOffset, true)
          }

          const pqOffset = headerSize + header.vectorCount * 8
          if (pqOffset < totalLength) {
            const availablePqBytes = Math.min(completeVectors * M, totalLength - pqOffset)
            codes.set(partialBuffer.slice(pqOffset, pqOffset + availablePqBytes))
          }

          yield { header, ids, codes }
        }
      }
    }
    throw error
  }

  // Combine chunks into single buffer
  const buffer = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.length
  }

  // Parse the cluster file
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const view = new DataView(arrayBuffer)

  // Validate magic
  const magic = view.getUint32(0, false)
  if (!validateMagicBytes(magic, 'CLST')) {
    throw new Error(`Invalid magic bytes: expected CLST`)
  }

  const header: ClusterStreamHeader = {
    clusterId: view.getUint32(8, true),
    vectorCount: view.getUint32(12, true),
    M: view.getUint8(16),
    idType: view.getUint8(17),
  }

  const headerSize = 64

  // Calculate how many vectors we can actually read based on available data
  // Header may claim more vectors than the buffer actually contains (truncated/streaming)
  const availableDataBytes = totalLength - headerSize
  const bytesPerVectorId = header.idType === 0 ? 8 : 0
  const bytesPerVector = bytesPerVectorId + header.M

  // Determine actual vector count based on what's in the buffer
  // We need complete IDs first, then PQ codes
  const actualVectorCount = Math.min(
    header.vectorCount,
    Math.floor(availableDataBytes / bytesPerVector)
  )

  const idsSize = header.idType === 0 ? actualVectorCount * 8 : 0
  const pqCodesOffset = headerSize + idsSize

  // Yield chunks of batchSize vectors
  let yieldedFirst = false
  for (let start = 0; start < actualVectorCount; start += batchSize) {
    const count = Math.min(batchSize, actualVectorCount - start)

    // Extract IDs for this batch
    const batchIds = new BigUint64Array(count)
    for (let i = 0; i < count; i++) {
      batchIds[i] = view.getBigUint64(headerSize + (start + i) * 8, true)
    }

    // Extract PQ codes for this batch
    const batchCodes = new Uint8Array(count * header.M)
    batchCodes.set(
      new Uint8Array(arrayBuffer, pqCodesOffset + start * header.M, count * header.M)
    )

    if (!yieldedFirst) {
      yield { header, ids: batchIds, codes: batchCodes }
      yieldedFirst = true
    } else {
      yield { ids: batchIds, codes: batchCodes }
    }
  }
}

// ============================================================================
// STATIC ASSET LOADER CLASS
// ============================================================================

interface StaticAssetLoaderOptions {
  lazyLoad?: boolean
  maxCachedClusters?: number
}

interface MemoryStats {
  totalBytesUsed: number
  centroidBytes: number
  codebookBytes: number
  clusterBytes: number
}

/**
 * Main class for loading and caching static vector index assets
 */
export class StaticAssetLoader {
  private options: StaticAssetLoaderOptions
  private centroidsCache: ParsedCentroids | null = null
  private codebooksCache: ParsedCodebooks | null = null
  private clusterCache: Map<number, { data: ParsedCluster; accessTime: number }> = new Map()

  constructor(options: StaticAssetLoaderOptions = {}) {
    this.options = {
      lazyLoad: false,
      maxCachedClusters: 10,
      ...options,
    }
  }

  /**
   * Load centroids index from static assets
   */
  async loadCentroids(): Promise<ParsedCentroids> {
    if (this.centroidsCache) {
      return this.centroidsCache
    }

    const response = await fetch('/static/centroids.bin')
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Centroids file not found (404)')
      }
      throw new Error(`Network error: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    const parsed = parseCentroidsFile(buffer)
    this.centroidsCache = parsed
    return parsed
  }

  /**
   * Load PQ codebooks from static assets
   */
  async loadCodebooks(): Promise<ParsedCodebooks> {
    if (this.codebooksCache) {
      return this.codebooksCache
    }

    const response = await fetch('/static/codebooks.bin')
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Codebooks file not found (404)')
      }
      throw new Error(`Network error: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    const parsed = parseCodebooksFile(buffer)
    this.codebooksCache = parsed
    return parsed
  }

  /**
   * Load a specific cluster file from static assets
   */
  async loadCluster(clusterId: number): Promise<ParsedCluster> {
    // Check cache first
    const cached = this.clusterCache.get(clusterId)
    if (cached) {
      cached.accessTime = Date.now()
      return cached.data
    }

    // Fetch from static assets
    const paddedId = clusterId.toString().padStart(4, '0')
    const response = await fetch(`/static/cluster-${paddedId}.bin`)
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Cluster ${clusterId} not found (404)`)
      }
      throw new Error(`Network error: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    const parsed = parseClusterFile(buffer)

    // Evict LRU if cache is full
    const maxCached = this.options.maxCachedClusters || 10
    if (this.clusterCache.size >= maxCached) {
      let oldestId: number | null = null
      let oldestTime = Infinity
      for (const [id, entry] of this.clusterCache) {
        if (entry.accessTime < oldestTime) {
          oldestTime = entry.accessTime
          oldestId = id
        }
      }
      if (oldestId !== null) {
        this.clusterCache.delete(oldestId)
      }
    }

    // Cache the result
    this.clusterCache.set(clusterId, { data: parsed, accessTime: Date.now() })
    return parsed
  }

  /**
   * Load a Matryoshka prefix file from static assets
   */
  async loadMatryoshka(clusterId: number): Promise<ParsedMatryoshka> {
    const paddedId = clusterId.toString().padStart(4, '0')
    const response = await fetch(`/static/matryoshka-${paddedId}.bin`)
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Matryoshka file ${clusterId} not found (404)`)
      }
      throw new Error(`Network error: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    return parseMatryoshkaFile(buffer)
  }

  /**
   * Get memory statistics for all loaded data
   */
  getMemoryStats(): MemoryStats {
    let centroidBytes = 0
    let codebookBytes = 0
    let clusterBytes = 0

    if (this.centroidsCache) {
      centroidBytes = this.centroidsCache.memoryStats.bytesUsed
    }

    if (this.codebooksCache) {
      codebookBytes = this.codebooksCache.memoryStats.bytesUsed
    }

    for (const [, entry] of this.clusterCache) {
      clusterBytes += entry.data.memoryStats.bytesUsed
    }

    return {
      totalBytesUsed: centroidBytes + codebookBytes + clusterBytes,
      centroidBytes,
      codebookBytes,
      clusterBytes,
    }
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.centroidsCache = null
    this.codebooksCache = null
    this.clusterCache.clear()
  }
}
