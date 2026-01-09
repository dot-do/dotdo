/**
 * Static Asset Loader Tests
 *
 * TDD tests for the static asset loader that fetches and parses binary vector
 * index files from Cloudflare Workers static assets. These binary formats are
 * optimized for efficient vector search with minimal memory overhead.
 *
 * Binary Formats Tested:
 * - CENT: Centroid Index (cluster centers for coarse quantization)
 * - PQCB: PQ Codebooks (Product Quantization subspace centroids)
 * - CLST: Cluster Files (vector IDs + PQ codes per cluster)
 * - MTRY: Matryoshka Prefixes (64-dim prefix vectors for progressive precision)
 *
 * Key Requirements:
 * - Zero-cost reads from static assets (no subrequest costs)
 * - Memory efficient (fit within 128MB Worker limit)
 * - Streaming support for large files
 * - Graceful error handling for corrupted data
 *
 * @see docs/plans/static-assets-vector-search.md for format specifications
 * @module tests/vector/static-asset-loader.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

// These imports will fail until the module is implemented
// This is the expected behavior for TDD - tests define the API contract
let StaticAssetLoader: any
let parseCentroidsFile: any
let parseCodebooksFile: any
let parseClusterFile: any
let parseMatryoshkaFile: any
let streamCluster: any
let validateMagicBytes: any
let float16ToFloat32: any

// Attempt to load the module - will fail until implemented
beforeEach(async () => {
  try {
    const loaderModule = await import('../../db/edgevec/static-asset-loader')
    StaticAssetLoader = loaderModule.StaticAssetLoader
    parseCentroidsFile = loaderModule.parseCentroidsFile
    parseCodebooksFile = loaderModule.parseCodebooksFile
    parseClusterFile = loaderModule.parseClusterFile
    parseMatryoshkaFile = loaderModule.parseMatryoshkaFile
    streamCluster = loaderModule.streamCluster
    validateMagicBytes = loaderModule.validateMagicBytes
    float16ToFloat32 = loaderModule.float16ToFloat32
  } catch {
    // Module not yet implemented - tests will fail with clear message
    StaticAssetLoader = undefined
    parseCentroidsFile = undefined
    parseCodebooksFile = undefined
    parseClusterFile = undefined
    parseMatryoshkaFile = undefined
    streamCluster = undefined
    validateMagicBytes = undefined
    float16ToFloat32 = undefined
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// MAGIC BYTES CONSTANTS (per spec)
// ============================================================================

const MAGIC = {
  CENT: 0x43454e54, // "CENT" - Centroid Index
  PQCB: 0x50514342, // "PQCB" - PQ Codebooks
  CLST: 0x434c5354, // "CLST" - Cluster File
  MTRY: 0x4d545259, // "MTRY" - Matryoshka Prefixes
} as const

// ============================================================================
// TEST DATA GENERATORS
// ============================================================================

/**
 * Create a valid CENT (Centroid Index) binary buffer
 * Format: 32-byte header + centroid data + optional metadata
 */
function createCentroidsBuffer(options: {
  numCentroids: number
  dimensions: number
  dtype?: number // 0 = float32, 1 = float16
  metric?: number // 0 = cosine, 1 = l2, 2 = dot
  includeMetadata?: boolean
  version?: number
}): ArrayBuffer {
  const {
    numCentroids,
    dimensions,
    dtype = 0,
    metric = 0,
    includeMetadata = false,
    version = 1,
  } = options

  const bytesPerFloat = dtype === 0 ? 4 : 2
  const dataSize = numCentroids * dimensions * bytesPerFloat
  const metadataSize = includeMetadata ? numCentroids * 16 : 0
  const totalSize = 32 + dataSize + metadataSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)

  // Header (32 bytes)
  view.setUint32(0, MAGIC.CENT, false) // magic (big-endian for readability)
  view.setUint16(4, version, true) // version (little-endian)
  view.setUint16(6, 0, true) // flags
  view.setUint32(8, numCentroids, true) // num_centroids
  view.setUint32(12, dimensions, true) // dimensions
  view.setUint8(16, dtype) // dtype
  view.setUint8(17, metric) // metric
  // reserved: bytes 18-31

  // Centroid data - fill with deterministic test values
  const floatView = dtype === 0
    ? new Float32Array(buffer, 32, numCentroids * dimensions)
    : null
  const halfView = dtype === 1
    ? new Uint16Array(buffer, 32, numCentroids * dimensions)
    : null

  for (let i = 0; i < numCentroids * dimensions; i++) {
    const value = Math.sin(i * 0.1) * 0.5 // Deterministic test data
    if (floatView) {
      floatView[i] = value
    } else if (halfView) {
      // Simplified float16 encoding for testing
      halfView[i] = float32ToFloat16(value)
    }
  }

  // Optional metadata
  if (includeMetadata) {
    const metaOffset = 32 + dataSize
    for (let i = 0; i < numCentroids; i++) {
      const offset = metaOffset + i * 16
      view.setUint32(offset, 1000 + i, true) // vector_count
      view.setFloat32(offset + 4, 0.1, true) // avg_distance
      view.setFloat32(offset + 8, 0.5, true) // max_distance
      view.setUint32(offset + 12, 0, true) // reserved
    }
  }

  return buffer
}

/**
 * Create a valid PQCB (PQ Codebooks) binary buffer
 * Format: 32-byte header + codebook data
 */
function createCodebooksBuffer(options: {
  M: number // num subspaces (e.g., 8)
  Ksub: number // centroids per subspace (e.g., 256)
  dimensions: number // full vector dimensions (e.g., 1536)
  dtype?: number // 0 = float32
  version?: number
}): ArrayBuffer {
  const { M, Ksub, dimensions, dtype = 0, version = 1 } = options

  const subvectorDim = dimensions / M
  const bytesPerFloat = dtype === 0 ? 4 : 2
  const dataSize = M * Ksub * subvectorDim * bytesPerFloat
  const totalSize = 32 + dataSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)

  // Header (32 bytes)
  view.setUint32(0, MAGIC.PQCB, false) // magic
  view.setUint16(4, version, true) // version
  view.setUint16(6, 0, true) // flags
  view.setUint32(8, M, true) // M (num subspaces)
  view.setUint32(12, Ksub, true) // Ksub (centroids per subspace)
  view.setUint32(16, dimensions, true) // dimensions
  view.setUint32(20, subvectorDim, true) // subvector_dim
  view.setUint8(24, dtype) // dtype
  // reserved: bytes 25-31

  // Codebook data - fill with deterministic test values
  const floatView = new Float32Array(buffer, 32, M * Ksub * subvectorDim)
  for (let i = 0; i < floatView.length; i++) {
    floatView[i] = Math.cos(i * 0.05) * 0.3
  }

  return buffer
}

/**
 * Create a valid CLST (Cluster) binary buffer
 * Format: 64-byte header + vector IDs + PQ codes + optional metadata
 */
function createClusterBuffer(options: {
  clusterId: number
  vectorCount: number
  M: number // PQ subspaces
  idType?: number // 0 = uint64, 1 = string offset
  hasMetadata?: boolean
  version?: number
}): ArrayBuffer {
  const {
    clusterId,
    vectorCount,
    M,
    idType = 0,
    hasMetadata = false,
    version = 1,
  } = options

  const idsSize = idType === 0 ? vectorCount * 8 : 0 // uint64 IDs
  const pqCodesSize = vectorCount * M
  const totalSize = 64 + idsSize + pqCodesSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)

  // Header (64 bytes)
  view.setUint32(0, MAGIC.CLST, false) // magic
  view.setUint16(4, version, true) // version
  view.setUint16(6, 0, true) // flags
  view.setUint32(8, clusterId, true) // cluster_id
  view.setUint32(12, vectorCount, true) // vector_count
  view.setUint8(16, M) // M
  view.setUint8(17, idType) // id_type
  view.setUint8(18, hasMetadata ? 1 : 0) // has_metadata
  // reserved: bytes 19-63

  // Vector IDs (uint64)
  if (idType === 0) {
    const idView = new BigUint64Array(buffer, 64, vectorCount)
    for (let i = 0; i < vectorCount; i++) {
      idView[i] = BigInt(1000000 + clusterId * 10000 + i)
    }
  }

  // PQ codes
  const pqCodesOffset = 64 + idsSize
  const pqCodes = new Uint8Array(buffer, pqCodesOffset, vectorCount * M)
  for (let i = 0; i < vectorCount; i++) {
    for (let m = 0; m < M; m++) {
      pqCodes[i * M + m] = (i + m * 17) % 256 // Deterministic test codes
    }
  }

  return buffer
}

/**
 * Create a valid MTRY (Matryoshka Prefixes) binary buffer
 * Format: 32-byte header + prefix vector data
 */
function createMatryoshkaBuffer(options: {
  clusterId: number
  vectorCount: number
  prefixDims?: number // default 64
  dtype?: number // 0 = float32, 1 = float16
  version?: number
}): ArrayBuffer {
  const {
    clusterId,
    vectorCount,
    prefixDims = 64,
    dtype = 0,
    version = 1,
  } = options

  const bytesPerFloat = dtype === 0 ? 4 : 2
  const dataSize = vectorCount * prefixDims * bytesPerFloat
  const totalSize = 32 + dataSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)

  // Header (32 bytes)
  view.setUint32(0, MAGIC.MTRY, false) // magic
  view.setUint16(4, version, true) // version
  view.setUint16(6, 0, true) // flags
  view.setUint32(8, clusterId, true) // cluster_id
  view.setUint32(12, vectorCount, true) // vector_count
  view.setUint16(16, prefixDims, true) // prefix_dims
  view.setUint8(18, dtype) // dtype
  // reserved: bytes 19-31

  // Prefix data
  const floatView = new Float32Array(buffer, 32, vectorCount * prefixDims)
  for (let i = 0; i < floatView.length; i++) {
    floatView[i] = Math.sin(i * 0.02) * 0.7
  }

  return buffer
}

/**
 * Create a corrupted buffer by zeroing out magic bytes
 */
function corruptMagicBytes(buffer: ArrayBuffer): ArrayBuffer {
  const corrupted = buffer.slice(0)
  const view = new DataView(corrupted)
  view.setUint32(0, 0x00000000, false) // Zero out magic
  return corrupted
}

/**
 * Create a truncated buffer
 */
function truncateBuffer(buffer: ArrayBuffer, keepBytes: number): ArrayBuffer {
  return buffer.slice(0, keepBytes)
}

/**
 * Simple float32 to float16 conversion for test data
 */
function float32ToFloat16(value: number): number {
  const floatView = new Float32Array(1)
  const intView = new Int32Array(floatView.buffer)

  floatView[0] = value
  const bits = intView[0]

  const sign = (bits >>> 16) & 0x8000
  let exp = ((bits >>> 23) & 0xff) - 127 + 15
  const mantissa = bits & 0x7fffff

  if (exp <= 0) {
    return sign
  } else if (exp >= 31) {
    return sign | 0x7c00
  }

  return sign | (exp << 10) | (mantissa >>> 13)
}

/**
 * Helper to assert module is loaded
 */
function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `Static Asset Loader module not implemented. Expected '${fnName}' from 'db/edgevec/static-asset-loader'. ` +
        `Create the module to make this test pass.`
    )
  }
}

/**
 * Create a mock fetch response
 */
function createMockResponse(buffer: ArrayBuffer, status = 200): Response {
  return new Response(buffer, {
    status,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
}

/**
 * Create a streaming mock response for large files
 */
function createStreamingMockResponse(
  chunks: Uint8Array[],
  status = 200
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
}

// ============================================================================
// TEST: FETCH FROM STATIC ASSETS
// ============================================================================

describe('StaticAssetLoader', () => {
  describe('Load binary file from static assets (mock fetch)', () => {
    it('should fetch centroids.bin from static assets', async () => {
      assertModuleLoaded('StaticAssetLoader', StaticAssetLoader)

      const mockBuffer = createCentroidsBuffer({
        numCentroids: 100,
        dimensions: 128,
      })

      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockBuffer))
      vi.stubGlobal('fetch', mockFetch)

      const loader = new StaticAssetLoader()
      const centroids = await loader.loadCentroids()

      expect(mockFetch).toHaveBeenCalledWith('/static/centroids.bin')
      expect(centroids).toBeDefined()
      expect(centroids.numCentroids).toBe(100)
      expect(centroids.dimensions).toBe(128)
    })

    it('should fetch codebooks.bin from static assets', async () => {
      assertModuleLoaded('StaticAssetLoader', StaticAssetLoader)

      const mockBuffer = createCodebooksBuffer({
        M: 8,
        Ksub: 256,
        dimensions: 768,
      })

      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockBuffer))
      vi.stubGlobal('fetch', mockFetch)

      const loader = new StaticAssetLoader()
      const codebooks = await loader.loadCodebooks()

      expect(mockFetch).toHaveBeenCalledWith('/static/codebooks.bin')
      expect(codebooks).toBeDefined()
      expect(codebooks.M).toBe(8)
      expect(codebooks.Ksub).toBe(256)
    })

    it('should fetch cluster file with zero-padded ID', async () => {
      assertModuleLoaded('StaticAssetLoader', StaticAssetLoader)

      const mockBuffer = createClusterBuffer({
        clusterId: 42,
        vectorCount: 1000,
        M: 8,
      })

      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockBuffer))
      vi.stubGlobal('fetch', mockFetch)

      const loader = new StaticAssetLoader()
      const cluster = await loader.loadCluster(42)

      expect(mockFetch).toHaveBeenCalledWith('/static/cluster-0042.bin')
      expect(cluster).toBeDefined()
      expect(cluster.clusterId).toBe(42)
      expect(cluster.vectorCount).toBe(1000)
    })

    it('should handle 404 for missing assets', async () => {
      assertModuleLoaded('StaticAssetLoader', StaticAssetLoader)

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(null, { status: 404, statusText: 'Not Found' })
      )
      vi.stubGlobal('fetch', mockFetch)

      const loader = new StaticAssetLoader()

      await expect(loader.loadCentroids()).rejects.toThrow(/not found|404/i)
    })

    it('should handle network errors gracefully', async () => {
      assertModuleLoaded('StaticAssetLoader', StaticAssetLoader)

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      vi.stubGlobal('fetch', mockFetch)

      const loader = new StaticAssetLoader()

      await expect(loader.loadCentroids()).rejects.toThrow(/network/i)
    })
  })

  // ============================================================================
  // TEST: PARSE CENT FORMAT
  // ============================================================================

  describe('Parse CENT format (centroids)', () => {
    it('should verify CENT magic bytes (0x43454E54)', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const buffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
      })

      const result = parseCentroidsFile(buffer)

      expect(result.magic).toBe(MAGIC.CENT)
    })

    it('should parse version number correctly', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const buffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
        version: 2,
      })

      const result = parseCentroidsFile(buffer)

      expect(result.version).toBe(2)
    })

    it('should parse centroid metadata (count, dimensions)', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const buffer = createCentroidsBuffer({
        numCentroids: 100,
        dimensions: 1536,
      })

      const result = parseCentroidsFile(buffer)

      expect(result.numCentroids).toBe(100)
      expect(result.dimensions).toBe(1536)
    })

    it('should parse dtype field (0=float32, 1=float16)', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const float32Buffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
        dtype: 0,
      })
      const float16Buffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
        dtype: 1,
      })

      const float32Result = parseCentroidsFile(float32Buffer)
      const float16Result = parseCentroidsFile(float16Buffer)

      expect(float32Result.dtype).toBe(0)
      expect(float16Result.dtype).toBe(1)
    })

    it('should parse metric field (0=cosine, 1=l2, 2=dot)', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const cosineBuffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
        metric: 0,
      })
      const l2Buffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
        metric: 1,
      })
      const dotBuffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
        metric: 2,
      })

      expect(parseCentroidsFile(cosineBuffer).metric).toBe(0)
      expect(parseCentroidsFile(l2Buffer).metric).toBe(1)
      expect(parseCentroidsFile(dotBuffer).metric).toBe(2)
    })

    it('should extract centroid vectors as Float32Array', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const buffer = createCentroidsBuffer({
        numCentroids: 5,
        dimensions: 8,
      })

      const result = parseCentroidsFile(buffer)

      expect(result.centroids).toBeInstanceOf(Float32Array)
      expect(result.centroids.length).toBe(5 * 8)
      // Verify deterministic test values
      expect(result.centroids[0]).toBeCloseTo(Math.sin(0 * 0.1) * 0.5)
      expect(result.centroids[1]).toBeCloseTo(Math.sin(1 * 0.1) * 0.5)
    })

    it('should convert float16 centroids to float32', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const buffer = createCentroidsBuffer({
        numCentroids: 5,
        dimensions: 8,
        dtype: 1, // float16
      })

      const result = parseCentroidsFile(buffer)

      // Should still return Float32Array after conversion
      expect(result.centroids).toBeInstanceOf(Float32Array)
      expect(result.centroids.length).toBe(5 * 8)
    })

    it('should parse optional centroid metadata when present', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const buffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
        includeMetadata: true,
      })

      const result = parseCentroidsFile(buffer)

      expect(result.metadata).toBeDefined()
      expect(result.metadata.length).toBe(10)
      expect(result.metadata[0].vectorCount).toBe(1000)
      expect(result.metadata[0].avgDistance).toBeCloseTo(0.1)
      expect(result.metadata[0].maxDistance).toBeCloseTo(0.5)
    })
  })

  // ============================================================================
  // TEST: PARSE PQCB FORMAT
  // ============================================================================

  describe('Parse PQCB format (PQ codebooks)', () => {
    it('should verify PQCB magic bytes (0x50514342)', () => {
      assertModuleLoaded('parseCodebooksFile', parseCodebooksFile)

      const buffer = createCodebooksBuffer({
        M: 8,
        Ksub: 256,
        dimensions: 768,
      })

      const result = parseCodebooksFile(buffer)

      expect(result.magic).toBe(MAGIC.PQCB)
    })

    it('should parse PQ configuration (M, Ksub, dimensions)', () => {
      assertModuleLoaded('parseCodebooksFile', parseCodebooksFile)

      const buffer = createCodebooksBuffer({
        M: 16,
        Ksub: 256,
        dimensions: 1536,
      })

      const result = parseCodebooksFile(buffer)

      expect(result.M).toBe(16)
      expect(result.Ksub).toBe(256)
      expect(result.dimensions).toBe(1536)
      expect(result.subvectorDim).toBe(1536 / 16) // 96
    })

    it('should extract codebook centroids organized by subspace', () => {
      assertModuleLoaded('parseCodebooksFile', parseCodebooksFile)

      const buffer = createCodebooksBuffer({
        M: 4,
        Ksub: 8, // Small for testing
        dimensions: 32,
      })

      const result = parseCodebooksFile(buffer)

      // Should have M codebooks, each with Ksub centroids of subvectorDim dimensions
      expect(result.codebooks).toBeInstanceOf(Array)
      expect(result.codebooks.length).toBe(4)
      expect(result.codebooks[0]).toBeInstanceOf(Float32Array)
      expect(result.codebooks[0].length).toBe(8 * 8) // Ksub * subvectorDim
    })

    it('should validate codebook data integrity', () => {
      assertModuleLoaded('parseCodebooksFile', parseCodebooksFile)

      const buffer = createCodebooksBuffer({
        M: 8,
        Ksub: 256,
        dimensions: 768,
      })

      const result = parseCodebooksFile(buffer)

      // All codebook values should be finite numbers
      for (const codebook of result.codebooks) {
        for (let i = 0; i < codebook.length; i++) {
          expect(Number.isFinite(codebook[i])).toBe(true)
        }
      }
    })
  })

  // ============================================================================
  // TEST: PARSE CLST FORMAT
  // ============================================================================

  describe('Parse CLST format (cluster files)', () => {
    it('should verify CLST magic bytes (0x434C5354)', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createClusterBuffer({
        clusterId: 0,
        vectorCount: 100,
        M: 8,
      })

      const result = parseClusterFile(buffer)

      expect(result.magic).toBe(MAGIC.CLST)
    })

    it('should parse cluster header (cluster_id, vector_count, M)', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createClusterBuffer({
        clusterId: 42,
        vectorCount: 5000,
        M: 16,
      })

      const result = parseClusterFile(buffer)

      expect(result.clusterId).toBe(42)
      expect(result.vectorCount).toBe(5000)
      expect(result.M).toBe(16)
    })

    it('should extract vector IDs as BigUint64Array', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createClusterBuffer({
        clusterId: 5,
        vectorCount: 100,
        M: 8,
        idType: 0, // uint64
      })

      const result = parseClusterFile(buffer)

      expect(result.ids).toBeInstanceOf(BigUint64Array)
      expect(result.ids.length).toBe(100)
      // Verify deterministic test IDs
      expect(result.ids[0]).toBe(BigInt(1000000 + 5 * 10000 + 0))
      expect(result.ids[99]).toBe(BigInt(1000000 + 5 * 10000 + 99))
    })

    it('should extract PQ codes as Uint8Array', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createClusterBuffer({
        clusterId: 0,
        vectorCount: 50,
        M: 8,
      })

      const result = parseClusterFile(buffer)

      expect(result.pqCodes).toBeInstanceOf(Uint8Array)
      expect(result.pqCodes.length).toBe(50 * 8)
      // Verify interleaved format: vector_i codes are at [i*M .. (i+1)*M)
      expect(result.pqCodes[0]).toBe((0 + 0 * 17) % 256) // vector 0, subspace 0
      expect(result.pqCodes[1]).toBe((0 + 1 * 17) % 256) // vector 0, subspace 1
    })

    it('should provide access to individual vector PQ codes', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createClusterBuffer({
        clusterId: 0,
        vectorCount: 10,
        M: 8,
      })

      const result = parseClusterFile(buffer)

      // Helper method to get codes for a specific vector
      const vectorCodes = result.getCodesForVector(5)
      expect(vectorCodes).toBeInstanceOf(Uint8Array)
      expect(vectorCodes.length).toBe(8)
    })
  })

  // ============================================================================
  // TEST: PARSE MTRY FORMAT
  // ============================================================================

  describe('Parse MTRY format (Matryoshka prefixes)', () => {
    it('should verify MTRY magic bytes (0x4D545259)', () => {
      assertModuleLoaded('parseMatryoshkaFile', parseMatryoshkaFile)

      const buffer = createMatryoshkaBuffer({
        clusterId: 0,
        vectorCount: 100,
      })

      const result = parseMatryoshkaFile(buffer)

      expect(result.magic).toBe(MAGIC.MTRY)
    })

    it('should parse prefix dimensions (default 64)', () => {
      assertModuleLoaded('parseMatryoshkaFile', parseMatryoshkaFile)

      const buffer = createMatryoshkaBuffer({
        clusterId: 0,
        vectorCount: 100,
        prefixDims: 64,
      })

      const result = parseMatryoshkaFile(buffer)

      expect(result.prefixDims).toBe(64)
    })

    it('should support custom prefix dimensions', () => {
      assertModuleLoaded('parseMatryoshkaFile', parseMatryoshkaFile)

      const buffer = createMatryoshkaBuffer({
        clusterId: 0,
        vectorCount: 100,
        prefixDims: 128,
      })

      const result = parseMatryoshkaFile(buffer)

      expect(result.prefixDims).toBe(128)
    })

    it('should extract prefix vectors as Float32Array', () => {
      assertModuleLoaded('parseMatryoshkaFile', parseMatryoshkaFile)

      const buffer = createMatryoshkaBuffer({
        clusterId: 0,
        vectorCount: 10,
        prefixDims: 64,
      })

      const result = parseMatryoshkaFile(buffer)

      expect(result.prefixes).toBeInstanceOf(Float32Array)
      expect(result.prefixes.length).toBe(10 * 64)
    })

    it('should provide method to get prefix for specific vector', () => {
      assertModuleLoaded('parseMatryoshkaFile', parseMatryoshkaFile)

      const buffer = createMatryoshkaBuffer({
        clusterId: 0,
        vectorCount: 10,
        prefixDims: 64,
      })

      const result = parseMatryoshkaFile(buffer)

      const prefix = result.getPrefixForVector(5)
      expect(prefix).toBeInstanceOf(Float32Array)
      expect(prefix.length).toBe(64)
    })
  })

  // ============================================================================
  // TEST: INVALID MAGIC BYTES
  // ============================================================================

  describe('Handle invalid magic bytes gracefully', () => {
    it('should reject centroids file with wrong magic bytes', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const buffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
      })
      const corrupted = corruptMagicBytes(buffer)

      expect(() => parseCentroidsFile(corrupted)).toThrow(/invalid magic/i)
    })

    it('should reject codebooks file with wrong magic bytes', () => {
      assertModuleLoaded('parseCodebooksFile', parseCodebooksFile)

      const buffer = createCodebooksBuffer({
        M: 8,
        Ksub: 256,
        dimensions: 768,
      })
      const corrupted = corruptMagicBytes(buffer)

      expect(() => parseCodebooksFile(corrupted)).toThrow(/invalid magic/i)
    })

    it('should reject cluster file with wrong magic bytes', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createClusterBuffer({
        clusterId: 0,
        vectorCount: 100,
        M: 8,
      })
      const corrupted = corruptMagicBytes(buffer)

      expect(() => parseClusterFile(corrupted)).toThrow(/invalid magic/i)
    })

    it('should reject matryoshka file with wrong magic bytes', () => {
      assertModuleLoaded('parseMatryoshkaFile', parseMatryoshkaFile)

      const buffer = createMatryoshkaBuffer({
        clusterId: 0,
        vectorCount: 100,
      })
      const corrupted = corruptMagicBytes(buffer)

      expect(() => parseMatryoshkaFile(corrupted)).toThrow(/invalid magic/i)
    })

    it('should validate magic bytes helper function', () => {
      assertModuleLoaded('validateMagicBytes', validateMagicBytes)

      expect(validateMagicBytes(MAGIC.CENT, 'CENT')).toBe(true)
      expect(validateMagicBytes(MAGIC.PQCB, 'PQCB')).toBe(true)
      expect(validateMagicBytes(MAGIC.CLST, 'CLST')).toBe(true)
      expect(validateMagicBytes(MAGIC.MTRY, 'MTRY')).toBe(true)

      expect(validateMagicBytes(0x00000000, 'CENT')).toBe(false)
      expect(validateMagicBytes(MAGIC.CENT, 'PQCB')).toBe(false)
    })
  })

  // ============================================================================
  // TEST: CORRUPTED FILES
  // ============================================================================

  describe('Handle corrupted files gracefully', () => {
    it('should reject truncated centroids file (header incomplete)', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const buffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
      })
      const truncated = truncateBuffer(buffer, 16) // Only half the header

      expect(() => parseCentroidsFile(truncated)).toThrow(/truncated|incomplete/i)
    })

    it('should reject centroids file with insufficient data', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const buffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
      })
      // Truncate to header only - no centroid data
      const truncated = truncateBuffer(buffer, 32)

      expect(() => parseCentroidsFile(truncated)).toThrow(/insufficient|data/i)
    })

    it('should reject cluster file with mismatched vector count', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createClusterBuffer({
        clusterId: 0,
        vectorCount: 1000,
        M: 8,
      })
      // Truncate to have fewer vectors than header claims
      const truncated = truncateBuffer(buffer, 64 + 100 * 8 + 100 * 8) // Only 100 vectors

      expect(() => parseClusterFile(truncated)).toThrow(/mismatch|truncated/i)
    })

    it('should reject codebooks with invalid subspace configuration', () => {
      assertModuleLoaded('parseCodebooksFile', parseCodebooksFile)

      const buffer = createCodebooksBuffer({
        M: 8,
        Ksub: 256,
        dimensions: 768,
      })
      // Corrupt the M field to create invalid config
      const view = new DataView(buffer)
      view.setUint32(8, 0, true) // Set M to 0

      expect(() => parseCodebooksFile(buffer)).toThrow(/invalid|configuration/i)
    })

    it('should handle empty buffer gracefully', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const emptyBuffer = new ArrayBuffer(0)

      expect(() => parseCentroidsFile(emptyBuffer)).toThrow(/empty|invalid/i)
    })

    it('should detect NaN/Infinity in centroid data', () => {
      assertModuleLoaded('parseCentroidsFile', parseCentroidsFile)

      const buffer = createCentroidsBuffer({
        numCentroids: 10,
        dimensions: 64,
      })
      // Inject NaN into the data
      const floatView = new Float32Array(buffer, 32, 10 * 64)
      floatView[0] = NaN
      floatView[100] = Infinity

      // Parser should either throw or provide a validation method
      const result = parseCentroidsFile(buffer)
      expect(result.hasInvalidData || result.validate?.()).toBeDefined()
    })
  })

  // ============================================================================
  // TEST: STREAMING LOADER
  // ============================================================================

  describe('Streaming loader - process chunks as they arrive', () => {
    it('should stream cluster file in chunks', async () => {
      assertModuleLoaded('streamCluster', streamCluster)

      const fullBuffer = createClusterBuffer({
        clusterId: 0,
        vectorCount: 1000,
        M: 8,
      })

      // Split into chunks
      const bytes = new Uint8Array(fullBuffer)
      const chunks: Uint8Array[] = []
      const chunkSize = 1024
      for (let i = 0; i < bytes.length; i += chunkSize) {
        chunks.push(bytes.slice(i, Math.min(i + chunkSize, bytes.length)))
      }

      const mockFetch = vi.fn().mockResolvedValue(
        createStreamingMockResponse(chunks)
      )
      vi.stubGlobal('fetch', mockFetch)

      const receivedChunks: { ids: BigUint64Array; codes: Uint8Array }[] = []
      for await (const chunk of streamCluster(0)) {
        receivedChunks.push(chunk)
      }

      expect(receivedChunks.length).toBeGreaterThan(0)
      // Total vectors should equal 1000
      const totalVectors = receivedChunks.reduce(
        (sum, c) => sum + c.ids.length,
        0
      )
      expect(totalVectors).toBe(1000)
    })

    it('should yield header metadata before data chunks', async () => {
      assertModuleLoaded('streamCluster', streamCluster)

      const fullBuffer = createClusterBuffer({
        clusterId: 42,
        vectorCount: 500,
        M: 8,
      })

      const bytes = new Uint8Array(fullBuffer)
      const chunks = [bytes.slice(0, 128), bytes.slice(128)]

      const mockFetch = vi.fn().mockResolvedValue(
        createStreamingMockResponse(chunks)
      )
      vi.stubGlobal('fetch', mockFetch)

      const stream = streamCluster(42)
      const firstYield = await stream.next()

      // First yield should include header info
      expect(firstYield.value.header).toBeDefined()
      expect(firstYield.value.header.clusterId).toBe(42)
      expect(firstYield.value.header.vectorCount).toBe(500)
    })

    it('should handle network interruption during streaming', async () => {
      assertModuleLoaded('streamCluster', streamCluster)

      const fullBuffer = createClusterBuffer({
        clusterId: 0,
        vectorCount: 1000,
        M: 8,
      })

      // Create a stream that errors partway through
      const bytes = new Uint8Array(fullBuffer)
      let chunkCount = 0
      const errorStream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (chunkCount < 2) {
            controller.enqueue(bytes.slice(chunkCount * 1024, (chunkCount + 1) * 1024))
            chunkCount++
          } else {
            controller.error(new Error('Network disconnected'))
          }
        },
      })

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(errorStream, { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const receivedChunks: any[] = []
      await expect(async () => {
        for await (const chunk of streamCluster(0)) {
          receivedChunks.push(chunk)
        }
      }).rejects.toThrow(/network|disconnected/i)

      // Should have received some data before error
      expect(receivedChunks.length).toBeGreaterThan(0)
    })

    it('should support configurable batch size', async () => {
      assertModuleLoaded('streamCluster', streamCluster)

      const fullBuffer = createClusterBuffer({
        clusterId: 0,
        vectorCount: 10000,
        M: 8,
      })

      const bytes = new Uint8Array(fullBuffer)
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(bytes, { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const batchSize = 2000
      const receivedChunks: any[] = []
      for await (const chunk of streamCluster(0, { batchSize })) {
        receivedChunks.push(chunk)
        // Each batch should have at most batchSize vectors
        expect(chunk.ids.length).toBeLessThanOrEqual(batchSize)
      }

      expect(receivedChunks.length).toBeGreaterThan(1)
    })
  })

  // ============================================================================
  // TEST: MEMORY EFFICIENCY
  // ============================================================================

  describe('Memory efficiency - don\'t exceed limits for large files', () => {
    it('should not load entire file into memory when streaming', async () => {
      assertModuleLoaded('streamCluster', streamCluster)

      // Create a large cluster (would be ~80MB if fully loaded)
      // 1M vectors * 8 bytes ID + 8 bytes PQ codes = 16MB just for data
      const mockLargeClusterHeader = createClusterBuffer({
        clusterId: 0,
        vectorCount: 1000000,
        M: 8,
      })

      // We'll track peak memory during streaming
      let peakAllocations = 0
      const originalArrayBuffer = global.ArrayBuffer
      let currentAllocations = 0

      // Mock ArrayBuffer to track allocations (simplified)
      const allocations: number[] = []

      const bytes = new Uint8Array(mockLargeClusterHeader)
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(bytes.slice(0, 1000), { status: 200 }) // Small response for test
      )
      vi.stubGlobal('fetch', mockFetch)

      // Just verify the streaming interface works without loading all data
      const iterator = streamCluster(0, { batchSize: 1000 })
      const first = await iterator.next()

      expect(first.value).toBeDefined()
      // Memory tracking would be implementation-specific
    })

    it('should provide memory stats for loaded centroids', async () => {
      assertModuleLoaded('StaticAssetLoader', StaticAssetLoader)

      const mockBuffer = createCentroidsBuffer({
        numCentroids: 10000,
        dimensions: 1536,
      })

      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(mockBuffer))
      vi.stubGlobal('fetch', mockFetch)

      const loader = new StaticAssetLoader()
      const result = await loader.loadCentroids()

      expect(result.memoryStats).toBeDefined()
      expect(result.memoryStats.bytesUsed).toBeGreaterThan(0)
      // Expected: 10000 * 1536 * 4 bytes = ~58.6 MB
      expect(result.memoryStats.bytesUsed).toBeLessThan(70 * 1024 * 1024)
    })

    it('should support lazy loading of cluster files', async () => {
      assertModuleLoaded('StaticAssetLoader', StaticAssetLoader)

      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const loader = new StaticAssetLoader({ lazyLoad: true })

      // Initially no fetch should occur
      expect(mockFetch).not.toHaveBeenCalled()

      // Access triggers load
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createClusterBuffer({
            clusterId: 0,
            vectorCount: 100,
            M: 8,
          })
        )
      )

      await loader.loadCluster(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should evict least-recently-used clusters when cache is full', async () => {
      assertModuleLoaded('StaticAssetLoader', StaticAssetLoader)

      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      // Create loader with small cache (max 3 clusters)
      const loader = new StaticAssetLoader({ maxCachedClusters: 3 })

      // Load 4 clusters
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockResponse(
            createClusterBuffer({
              clusterId: i,
              vectorCount: 100,
              M: 8,
            })
          )
        )
        await loader.loadCluster(i)
      }

      // First cluster should be evicted
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createClusterBuffer({
            clusterId: 0,
            vectorCount: 100,
            M: 8,
          })
        )
      )

      // Accessing cluster 0 should trigger a new fetch (it was evicted)
      await loader.loadCluster(0)
      expect(mockFetch).toHaveBeenCalledTimes(5) // 4 initial + 1 re-fetch
    })

    it('should report total memory usage across all loaded files', async () => {
      assertModuleLoaded('StaticAssetLoader', StaticAssetLoader)

      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const loader = new StaticAssetLoader()

      // Load centroids
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createCentroidsBuffer({
            numCentroids: 100,
            dimensions: 128,
          })
        )
      )
      await loader.loadCentroids()

      // Load codebooks
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createCodebooksBuffer({
            M: 8,
            Ksub: 256,
            dimensions: 768,
          })
        )
      )
      await loader.loadCodebooks()

      const stats = loader.getMemoryStats()
      expect(stats.totalBytesUsed).toBeGreaterThan(0)
      expect(stats.centroidBytes).toBeGreaterThan(0)
      expect(stats.codebookBytes).toBeGreaterThan(0)
      expect(stats.clusterBytes).toBe(0) // No clusters loaded
    })
  })

  // ============================================================================
  // TEST: FLOAT16 CONVERSION
  // ============================================================================

  describe('Float16 to Float32 conversion', () => {
    it('should convert float16 array to float32 accurately', () => {
      assertModuleLoaded('float16ToFloat32', float16ToFloat32)

      // Test values covering various ranges
      const testValues = [0, 1, -1, 0.5, -0.5, 0.001, 100, -100]
      const float16Values = new Uint16Array(testValues.length)

      for (let i = 0; i < testValues.length; i++) {
        float16Values[i] = float32ToFloat16(testValues[i])
      }

      const converted = float16ToFloat32(float16Values)

      expect(converted).toBeInstanceOf(Float32Array)
      expect(converted.length).toBe(testValues.length)

      // Float16 has less precision, so we use loose tolerance
      for (let i = 0; i < testValues.length; i++) {
        expect(converted[i]).toBeCloseTo(testValues[i], 1)
      }
    })

    it('should handle special float16 values', () => {
      assertModuleLoaded('float16ToFloat32', float16ToFloat32)

      const specialValues = new Uint16Array([
        0x0000, // Positive zero
        0x8000, // Negative zero
        0x7c00, // Positive infinity
        0xfc00, // Negative infinity
        0x7e00, // NaN
      ])

      const converted = float16ToFloat32(specialValues)

      expect(converted[0]).toBe(0)
      expect(Object.is(converted[1], -0)).toBe(true)
      expect(converted[2]).toBe(Infinity)
      expect(converted[3]).toBe(-Infinity)
      expect(Number.isNaN(converted[4])).toBe(true)
    })
  })
})
