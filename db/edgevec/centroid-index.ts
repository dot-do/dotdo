/**
 * Centroid Index - Static Asset Coarse Search for IVF Vector Search
 *
 * This module implements the coarse search stage of IVF (Inverted File) vector search.
 * It loads pre-computed cluster centroids from static binary assets and performs
 * efficient nearest centroid search to identify candidate clusters for PQ scoring.
 *
 * ## IVF-PQ Search Pipeline
 *
 * ```
 * Query Vector
 *     │
 *     ▼
 * ┌─────────────────────────┐
 * │   CentroidIndex         │  Stage 1: Coarse Search
 * │   Find top-nprobe       │  O(K) where K = num centroids
 * │   nearest centroids     │
 * └───────────┬─────────────┘
 *             │
 *             ▼
 * ┌─────────────────────────┐
 * │   PQ Code Search        │  Stage 2: Fine Search
 * │   Score vectors in      │  O(N/K * nprobe) with ADC
 * │   candidate clusters    │
 * └─────────────────────────┘
 * ```
 *
 * ## CENT Binary Format
 *
 * The CENT format is designed for efficient static asset loading:
 *
 * ```
 * ┌─────────────────────────────────────────────────┐
 * │ Header (32 bytes)                               │
 * │ ├─ magic: uint32 = 0x43454E54 ("CENT")         │
 * │ ├─ version: uint16 = 1                         │
 * │ ├─ flags: uint16 = 0                           │
 * │ ├─ num_centroids: uint32                       │
 * │ ├─ dimensions: uint32                          │
 * │ ├─ dtype: uint8 (0=float32, 1=float16)         │
 * │ ├─ metric: uint8 (0=cosine, 1=l2)              │
 * │ └─ reserved: uint8[10]                         │
 * ├─────────────────────────────────────────────────┤
 * │ Centroid Data                                   │
 * │ num_centroids * dimensions * sizeof(dtype)      │
 * └─────────────────────────────────────────────────┘
 * ```
 *
 * ## Performance Optimizations
 *
 * - **Flat Storage**: Centroids stored contiguously for cache efficiency
 * - **Pre-computed Norms**: Inverse norms pre-computed to avoid division in hot loop
 * - **Loop Unrolling**: 16-element unrolled loops with 4 accumulators for ILP
 * - **Partial Sort**: Max-heap based top-K selection avoids full sort
 * - **Pre-allocated Buffers**: Reusable distance and heap buffers avoid GC pressure
 *
 * @example Loading centroids from a static asset
 * ```typescript
 * import { CentroidIndex } from 'db/edgevec/centroid-index'
 *
 * // Load centroids from static asset
 * const centFile = await env.ASSETS.get('centroids.cent')
 * const centroid = new CentroidIndex()
 * await centroid.load(await centFile.arrayBuffer())
 *
 * console.log(`Loaded ${centroid.numCentroids} centroids`)
 * console.log(`Dimensions: ${centroid.dimensions}`)
 * console.log(`Metric: ${centroid.metric}`)
 * ```
 *
 * @example Coarse search for candidate clusters
 * ```typescript
 * // Find top 10 nearest centroids (nprobe = 10)
 * const query = new Float32Array(embedding)
 * const clusters = await centroid.search(query, 10)
 *
 * // clusters: [{ clusterId: 42, distance: 0.15 }, ...]
 * // Use clusterId to load PQ codes from corresponding cluster file
 * for (const { clusterId, distance } of clusters) {
 *   const clusterCodes = await loadClusterCodes(clusterId)
 *   // Score with PQ...
 * }
 * ```
 *
 * @example Search with statistics
 * ```typescript
 * const { results, stats } = await centroid.searchWithStats(query, 10)
 *
 * console.log(`Searched ${stats.centroidsScanned} centroids`)
 * console.log(`Search time: ${stats.searchTimeMs.toFixed(2)}ms`)
 * console.log(`Distance computations: ${stats.distanceComputations}`)
 * ```
 *
 * @module db/edgevec/centroid-index
 * @see {@link https://arxiv.org/abs/1702.08734 | Billion-scale similarity search with GPUs}
 */

import type { DistanceMetric } from '../../types/vector'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for CentroidIndex
 */
export interface CentroidIndexConfig {
  /** Lazy load centroids on first search */
  lazyLoad?: boolean
}

/**
 * Parsed CENT file header
 */
export interface CentroidFileHeader {
  /** Magic identifier 'CENT' */
  magic: string
  /** Format version */
  version: number
  /** Flags */
  flags: number
  /** Number of centroids */
  numCentroids: number
  /** Vector dimensions */
  dimensions: number
  /** Data type: 'float32' or 'float16' */
  dtype: 'float32' | 'float16'
  /** Distance metric */
  metric: DistanceMetric
}

/**
 * Search result with cluster ID and distance
 */
export interface ClusterMatch {
  /** Cluster/centroid ID */
  clusterId: number
  /** Distance to the cluster centroid */
  distance: number
}

/**
 * Search options
 */
export interface CentroidSearchOptions {
  /** Override the default metric */
  metric?: DistanceMetric
}

/**
 * Per-search statistics
 */
export interface SearchStats {
  /** Number of centroids scanned */
  centroidsScanned: number
  /** Time taken for search in milliseconds */
  searchTimeMs: number
  /** Number of distance computations */
  distanceComputations: number
}

/**
 * Cumulative statistics
 */
export interface CumulativeStats {
  /** Total number of searches */
  totalSearches: number
  /** Total distance computations */
  totalDistanceComputations: number
  /** Average search time in ms */
  avgSearchTimeMs: number
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  /** Bytes used for centroid data */
  centroidDataBytes: number
  /** Total bytes including overhead */
  totalBytes: number
  /** Overhead bytes */
  overheadBytes: number
}

/**
 * Index configuration info
 */
export interface IndexConfigInfo {
  numCentroids: number
  dimensions: number
  metric: DistanceMetric
  dtype: 'float32' | 'float16'
  version: number
}

/**
 * Search result with statistics
 */
export interface SearchWithStatsResult {
  results: ClusterMatch[]
  stats: SearchStats
}

// ============================================================================
// CONSTANTS
// ============================================================================

const HEADER_SIZE = 32
const MAGIC_BYTES = [0x43, 0x45, 0x4e, 0x54] // 'CENT'

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert float16 (half-precision) to float32
 */
function float16ToFloat32(h: number): number {
  const sign = (h & 0x8000) >> 15
  const exponent = (h & 0x7c00) >> 10
  const fraction = h & 0x03ff

  if (exponent === 0) {
    if (fraction === 0) {
      return sign ? -0 : 0
    }
    // Subnormal number
    return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024)
  } else if (exponent === 31) {
    if (fraction === 0) {
      return sign ? -Infinity : Infinity
    }
    return NaN
  }

  return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + fraction / 1024)
}

/**
 * Convert float32 to float16 (half-precision)
 */
function float32ToFloat16(value: number): number {
  const floatView = new Float32Array(1)
  const int32View = new Int32Array(floatView.buffer)
  floatView[0] = value
  const x = int32View[0]!

  const sign = (x >> 16) & 0x8000
  let exp = ((x >> 23) & 0xff) - 127 + 15
  const frac = x & 0x7fffff

  if (exp <= 0) {
    return sign
  } else if (exp >= 31) {
    return sign | 0x7c00
  }

  return sign | (exp << 10) | (frac >> 13)
}

/**
 * Calculate cosine distance between query and centroid (optimized)
 * For pre-normalized vectors, this simplifies to 1 - dot product
 * For general vectors, computes 1 - (a.b / |a||b|)
 */
function cosineDistanceOpt(
  query: Float32Array,
  centroid: Float32Array,
  queryNorm: number
): number {
  const len = query.length
  let dot = 0
  let normB = 0

  // Process 8 elements at a time for better CPU pipelining
  const limit = len - (len % 8)
  let i = 0

  for (; i < limit; i += 8) {
    dot +=
      query[i]! * centroid[i]! +
      query[i + 1]! * centroid[i + 1]! +
      query[i + 2]! * centroid[i + 2]! +
      query[i + 3]! * centroid[i + 3]! +
      query[i + 4]! * centroid[i + 4]! +
      query[i + 5]! * centroid[i + 5]! +
      query[i + 6]! * centroid[i + 6]! +
      query[i + 7]! * centroid[i + 7]!

    normB +=
      centroid[i]! * centroid[i]! +
      centroid[i + 1]! * centroid[i + 1]! +
      centroid[i + 2]! * centroid[i + 2]! +
      centroid[i + 3]! * centroid[i + 3]! +
      centroid[i + 4]! * centroid[i + 4]! +
      centroid[i + 5]! * centroid[i + 5]! +
      centroid[i + 6]! * centroid[i + 6]! +
      centroid[i + 7]! * centroid[i + 7]!
  }

  // Handle remaining elements
  for (; i < len; i++) {
    dot += query[i]! * centroid[i]!
    normB += centroid[i]! * centroid[i]!
  }

  const denom = queryNorm * Math.sqrt(normB)
  if (denom === 0) return 1
  return 1 - dot / denom
}

/**
 * Calculate L2 distance squared (avoid sqrt for comparison, take sqrt at end)
 */
function l2DistanceSquaredOpt(query: Float32Array, centroid: Float32Array): number {
  const len = query.length
  let sum = 0

  // Process 8 elements at a time
  const limit = len - (len % 8)
  let i = 0

  for (; i < limit; i += 8) {
    const d0 = query[i]! - centroid[i]!
    const d1 = query[i + 1]! - centroid[i + 1]!
    const d2 = query[i + 2]! - centroid[i + 2]!
    const d3 = query[i + 3]! - centroid[i + 3]!
    const d4 = query[i + 4]! - centroid[i + 4]!
    const d5 = query[i + 5]! - centroid[i + 5]!
    const d6 = query[i + 6]! - centroid[i + 6]!
    const d7 = query[i + 7]! - centroid[i + 7]!

    sum += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3 + d4 * d4 + d5 * d5 + d6 * d6 + d7 * d7
  }

  // Handle remaining elements
  for (; i < len; i++) {
    const d = query[i]! - centroid[i]!
    sum += d * d
  }

  return sum
}

/**
 * Calculate query vector norm
 */
function calculateNorm(vec: Float32Array): number {
  let sum = 0
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i]! * vec[i]!
  }
  return Math.sqrt(sum)
}

/**
 * Partial sort: get top-K smallest elements without full sort
 * Uses pre-allocated typed arrays for the heap to minimize allocations
 */
function partialSortTopK(
  distances: Float64Array,
  numCentroids: number,
  k: number,
  heapDist: Float64Array,
  heapIdx: Int32Array
): ClusterMatch[] {
  if (k >= numCentroids) {
    // Full sort needed - create indexed array
    const indexed: ClusterMatch[] = new Array(numCentroids)
    for (let i = 0; i < numCentroids; i++) {
      indexed[i] = { clusterId: i, distance: distances[i]! }
    }
    indexed.sort((a, b) => a.distance - b.distance)
    return indexed
  }

  let heapSize = 0

  // Process all distances
  for (let i = 0; i < numCentroids; i++) {
    const dist = distances[i]!

    if (heapSize < k) {
      // Heap not full - add and sift up
      heapDist[heapSize] = dist
      heapIdx[heapSize] = i
      // Sift up inline
      let idx = heapSize
      while (idx > 0) {
        const parent = (idx - 1) >> 1
        if (heapDist[parent]! >= heapDist[idx]!) break
        // Swap
        const td = heapDist[idx]!
        heapDist[idx] = heapDist[parent]!
        heapDist[parent] = td
        const ti = heapIdx[idx]!
        heapIdx[idx] = heapIdx[parent]!
        heapIdx[parent] = ti
        idx = parent
      }
      heapSize++
    } else if (dist < heapDist[0]!) {
      // Replace max and sift down
      heapDist[0] = dist
      heapIdx[0] = i
      // Sift down inline
      let idx = 0
      while (true) {
        let largest = idx
        const left = (idx << 1) + 1
        const right = (idx << 1) + 2
        if (left < heapSize && heapDist[left]! > heapDist[largest]!) {
          largest = left
        }
        if (right < heapSize && heapDist[right]! > heapDist[largest]!) {
          largest = right
        }
        if (largest === idx) break
        // Swap
        const td = heapDist[idx]!
        heapDist[idx] = heapDist[largest]!
        heapDist[largest] = td
        const ti = heapIdx[idx]!
        heapIdx[idx] = heapIdx[largest]!
        heapIdx[largest] = ti
        idx = largest
      }
    }
  }

  // Extract in sorted order by heap-sort extraction
  const result: ClusterMatch[] = new Array(heapSize)
  const origSize = heapSize
  for (let i = origSize - 1; i >= 0; i--) {
    result[i] = { clusterId: heapIdx[0]!, distance: heapDist[0]! }
    heapSize--
    if (heapSize > 0) {
      heapDist[0] = heapDist[heapSize]!
      heapIdx[0] = heapIdx[heapSize]!
      // Sift down
      let idx = 0
      while (true) {
        let largest = idx
        const left = (idx << 1) + 1
        const right = (idx << 1) + 2
        if (left < heapSize && heapDist[left]! > heapDist[largest]!) {
          largest = left
        }
        if (right < heapSize && heapDist[right]! > heapDist[largest]!) {
          largest = right
        }
        if (largest === idx) break
        const td = heapDist[idx]!
        heapDist[idx] = heapDist[largest]!
        heapDist[largest] = td
        const ti = heapIdx[idx]!
        heapIdx[idx] = heapIdx[largest]!
        heapIdx[largest] = ti
        idx = largest
      }
    }
  }

  return result
}

/**
 * Validate a query vector
 */
function validateVector(query: Float32Array): void {
  for (let i = 0; i < query.length; i++) {
    if (Number.isNaN(query[i]!)) {
      throw new Error('Invalid vector: contains NaN values')
    }
    if (!Number.isFinite(query[i]!)) {
      throw new Error('Invalid vector: contains Infinity values')
    }
  }
}

// ============================================================================
// PARSE & SERIALIZE
// ============================================================================

/**
 * Parse a CENT file and return header information
 */
export function parseCentroidFile(buffer: ArrayBuffer): CentroidFileHeader {
  if (buffer.byteLength < HEADER_SIZE) {
    throw new Error('Buffer size too small for CENT header')
  }

  const view = new DataView(buffer)

  // Check magic
  const magic =
    String.fromCharCode(view.getUint8(0)) +
    String.fromCharCode(view.getUint8(1)) +
    String.fromCharCode(view.getUint8(2)) +
    String.fromCharCode(view.getUint8(3))

  if (magic !== 'CENT') {
    throw new Error(`Invalid magic number: expected 'CENT', got '${magic}'`)
  }

  const version = view.getUint16(4, true)
  const flags = view.getUint16(6, true)
  const numCentroids = view.getUint32(8, true)
  const dimensions = view.getUint32(12, true)
  const dtypeCode = view.getUint8(16)
  const metricCode = view.getUint8(17)

  const dtype: 'float32' | 'float16' = dtypeCode === 0 ? 'float32' : 'float16'
  const metric: DistanceMetric = metricCode === 0 ? 'cosine' : 'l2'

  return {
    magic,
    version,
    flags,
    numCentroids,
    dimensions,
    dtype,
    metric,
  }
}

/**
 * Serialize a CentroidIndex back to CENT format
 */
export function serializeCentroidFile(index: CentroidIndex): ArrayBuffer {
  const centroids = index.getCentroids()
  const numCentroids = index.numCentroids
  const dimensions = index.dimensions
  const metric = index.metric
  const dtype = index.dtype

  const bytesPerElement = dtype === 'float16' ? 2 : 4
  const dataSize = numCentroids * dimensions * bytesPerElement
  const buffer = new ArrayBuffer(HEADER_SIZE + dataSize)

  const view = new DataView(buffer)

  // Write magic "CENT"
  view.setUint8(0, 0x43) // 'C'
  view.setUint8(1, 0x45) // 'E'
  view.setUint8(2, 0x4e) // 'N'
  view.setUint8(3, 0x54) // 'T'

  // Version
  view.setUint16(4, 1, true)

  // Flags
  view.setUint16(6, 0, true)

  // num_centroids
  view.setUint32(8, numCentroids, true)

  // dimensions
  view.setUint32(12, dimensions, true)

  // dtype: 0 = float32, 1 = float16
  view.setUint8(16, dtype === 'float32' ? 0 : 1)

  // metric: 0 = cosine, 1 = l2, 2 = dot
  view.setUint8(17, metric === 'cosine' ? 0 : metric === 'l2' ? 1 : 2)

  // Write centroid data
  if (dtype === 'float16') {
    const dataView = new DataView(buffer, HEADER_SIZE)
    let offset = 0
    for (const centroid of centroids) {
      for (let i = 0; i < dimensions; i++) {
        const float16 = float32ToFloat16(centroid[i]!)
        dataView.setUint16(offset, float16, true)
        offset += 2
      }
    }
  } else {
    const dataArray = new Float32Array(buffer, HEADER_SIZE)
    let offset = 0
    for (const centroid of centroids) {
      dataArray.set(centroid, offset)
      offset += dimensions
    }
  }

  return buffer
}

// ============================================================================
// CENTROID INDEX CLASS
// ============================================================================

/**
 * CentroidIndex - High-performance coarse search for IVF vector retrieval.
 *
 * This class loads cluster centroids from a binary CENT file and provides
 * efficient nearest centroid search for identifying candidate clusters.
 *
 * ## Memory Layout
 *
 * The centroids are stored in a contiguous Float32Array for optimal
 * cache performance during distance computation:
 *
 * ```
 * centroidsFlat: [c0_d0, c0_d1, ..., c0_dD, c1_d0, c1_d1, ..., c1_dD, ...]
 *                 ╰─────── centroid 0 ──────╯ ╰─────── centroid 1 ──────╯
 * ```
 *
 * ## Thread Safety
 *
 * CentroidIndex is designed for single-threaded use within Cloudflare Workers.
 * Each worker instance should have its own CentroidIndex instance.
 *
 * @example Basic usage
 * ```typescript
 * const index = new CentroidIndex()
 * await index.load(centFileBuffer)
 *
 * // Find nearest clusters
 * const matches = await index.search(queryVector, 10)
 * ```
 */
export class CentroidIndex {
  private _loaded = false
  private _numCentroids = 0
  private _dimensions = 0
  private _metric: DistanceMetric = 'cosine'
  private _dtype: 'float32' | 'float16' = 'float32'
  private _version = 1
  private _centroids: Float32Array[] = []
  // Flat storage for better cache performance
  private _centroidsFlat: Float32Array | null = null
  // Pre-computed norms for cosine distance
  private _centroidNorms: Float32Array | null = null
  // Pre-computed inverse norms to avoid division in hot loop
  private _centroidNormInvs: Float32Array | null = null
  private _rawBuffer: ArrayBuffer | null = null
  private _rawDataBytes = 0
  // Reusable distance buffer to avoid allocations
  private _distanceBuffer: Float64Array | null = null
  // Reusable heap buffers (preallocated for k=256 max)
  private _heapDist: Float64Array | null = null
  private _heapIdx: Int32Array | null = null

  // Statistics
  private _totalSearches = 0
  private _totalDistanceComputations = 0
  private _totalSearchTimeMs = 0

  // Configuration
  private _config: CentroidIndexConfig

  constructor(config: CentroidIndexConfig = {}) {
    this._config = config
  }

  /**
   * Load centroids from a CENT binary buffer
   */
  async load(buffer: ArrayBuffer): Promise<void> {
    // Parse header
    const header = parseCentroidFile(buffer)

    // Validate version
    if (header.version !== 1) {
      throw new Error(`Unsupported version: ${header.version}. Only version 1 is supported.`)
    }

    // Validate buffer size
    const bytesPerElement = header.dtype === 'float16' ? 2 : 4
    const expectedDataSize = header.numCentroids * header.dimensions * bytesPerElement
    const expectedBufferSize = HEADER_SIZE + expectedDataSize

    if (buffer.byteLength < expectedBufferSize) {
      throw new Error(
        `Buffer size mismatch: expected at least ${expectedBufferSize} bytes, got ${buffer.byteLength}`
      )
    }

    // Store header info
    this._numCentroids = header.numCentroids
    this._dimensions = header.dimensions
    this._metric = header.metric
    this._dtype = header.dtype
    this._version = header.version
    this._rawBuffer = buffer
    this._rawDataBytes = header.numCentroids * header.dimensions * bytesPerElement

    // Parse centroids into flat storage for cache-efficient access
    const totalElements = header.numCentroids * header.dimensions
    this._centroidsFlat = new Float32Array(totalElements)
    this._centroids = []

    if (header.dtype === 'float16') {
      const dataView = new DataView(buffer, HEADER_SIZE)
      let offset = 0
      let flatOffset = 0
      for (let c = 0; c < header.numCentroids; c++) {
        const centroid = new Float32Array(header.dimensions)
        for (let d = 0; d < header.dimensions; d++) {
          const float16 = dataView.getUint16(offset, true)
          const val = float16ToFloat32(float16)
          centroid[d] = val
          this._centroidsFlat[flatOffset++] = val
          offset += 2
        }
        this._centroids.push(centroid)
      }
    } else {
      const dataArray = new Float32Array(buffer, HEADER_SIZE, totalElements)
      // Copy to flat storage
      this._centroidsFlat.set(dataArray)
      // Create individual views for getCentroids()
      for (let c = 0; c < header.numCentroids; c++) {
        const start = c * header.dimensions
        const centroid = dataArray.slice(start, start + header.dimensions)
        this._centroids.push(centroid)
      }
    }

    // Precompute centroid norms and inverse norms for faster cosine distance
    this._centroidNorms = new Float32Array(header.numCentroids)
    this._centroidNormInvs = new Float32Array(header.numCentroids)
    for (let c = 0; c < header.numCentroids; c++) {
      let sum = 0
      const offset = c * header.dimensions
      for (let d = 0; d < header.dimensions; d++) {
        const val = this._centroidsFlat[offset + d]!
        sum += val * val
      }
      const norm = Math.sqrt(sum)
      this._centroidNorms[c] = norm
      this._centroidNormInvs[c] = norm > 0 ? 1 / norm : 0
    }

    // Preallocate distance buffer to avoid allocations during search
    this._distanceBuffer = new Float64Array(header.numCentroids)

    // Preallocate heap buffers (256 should cover most k values)
    this._heapDist = new Float64Array(256)
    this._heapIdx = new Int32Array(256)

    this._loaded = true
  }

  /**
   * Check if centroids are loaded
   */
  isLoaded(): boolean {
    return this._loaded
  }

  /**
   * Number of centroids in the index
   */
  get numCentroids(): number {
    return this._numCentroids
  }

  /**
   * Vector dimensions
   */
  get dimensions(): number {
    return this._dimensions
  }

  /**
   * Distance metric
   */
  get metric(): DistanceMetric {
    return this._metric
  }

  /**
   * Data type (float32 or float16)
   */
  get dtype(): 'float32' | 'float16' {
    return this._dtype
  }

  /**
   * Get all centroids (cached reference)
   */
  getCentroids(): Float32Array[] {
    return this._centroids
  }

  /**
   * Clear the index and release memory
   */
  clear(): void {
    this._loaded = false
    this._numCentroids = 0
    this._dimensions = 0
    this._centroids = []
    this._centroidsFlat = null
    this._centroidNorms = null
    this._centroidNormInvs = null
    this._distanceBuffer = null
    this._heapDist = null
    this._heapIdx = null
    this._rawBuffer = null
    this._rawDataBytes = 0
    this._totalSearches = 0
    this._totalDistanceComputations = 0
    this._totalSearchTimeMs = 0
  }

  /**
   * Get index configuration
   */
  getConfig(): IndexConfigInfo {
    return {
      numCentroids: this._numCentroids,
      dimensions: this._dimensions,
      metric: this._metric,
      dtype: this._dtype,
      version: this._version,
    }
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): MemoryStats {
    // Calculate centroid data bytes based on actual storage
    // For FP16 loaded into FP32 arrays, we use the original FP16/FP32 size
    const centroidDataBytes = this._rawDataBytes

    // Overhead: Float32Array headers (24 bytes each on V8), plus our metadata
    const arrayOverhead = this._numCentroids * 24
    const metadataOverhead = 256 // approximate

    return {
      centroidDataBytes,
      totalBytes: centroidDataBytes + arrayOverhead + metadataOverhead,
      overheadBytes: arrayOverhead + metadataOverhead,
    }
  }

  /**
   * Get cumulative search statistics
   */
  getCumulativeStats(): CumulativeStats {
    return {
      totalSearches: this._totalSearches,
      totalDistanceComputations: this._totalDistanceComputations,
      avgSearchTimeMs: this._totalSearches > 0 ? this._totalSearchTimeMs / this._totalSearches : 0,
    }
  }

  /**
   * Internal method to compute distances and find top-K (optimized hot path)
   */
  private _searchInternal(query: Float32Array, effectiveK: number, metric: DistanceMetric): ClusterMatch[] {
    const centroidsFlat = this._centroidsFlat!
    const centroidNormInvs = this._centroidNormInvs!
    const dims = this._dimensions
    const numCentroids = this._numCentroids
    const distances = this._distanceBuffer!

    // Pre-compute loop limit for dimensions not divisible by 16
    const dimsLimit16 = dims & ~15  // dims - (dims % 16)

    if (metric === 'cosine') {
      // Pre-compute query norm inverse (avoids division in hot loop)
      let qNormSq = 0
      for (let i = 0; i < dims; i++) {
        qNormSq += query[i]! * query[i]!
      }
      const queryNormInv = qNormSq > 0 ? 1 / Math.sqrt(qNormSq) : 0

      for (let i = 0; i < numCentroids; i++) {
        const offset = i * dims
        // Use 4 accumulators to exploit ILP (instruction-level parallelism)
        let dot0 = 0, dot1 = 0, dot2 = 0, dot3 = 0
        let d = 0

        // Process 16 elements at a time with 4 accumulators
        for (; d < dimsLimit16; d += 16) {
          const o = offset + d
          dot0 += query[d]! * centroidsFlat[o]! + query[d + 1]! * centroidsFlat[o + 1]! +
                  query[d + 2]! * centroidsFlat[o + 2]! + query[d + 3]! * centroidsFlat[o + 3]!
          dot1 += query[d + 4]! * centroidsFlat[o + 4]! + query[d + 5]! * centroidsFlat[o + 5]! +
                  query[d + 6]! * centroidsFlat[o + 6]! + query[d + 7]! * centroidsFlat[o + 7]!
          dot2 += query[d + 8]! * centroidsFlat[o + 8]! + query[d + 9]! * centroidsFlat[o + 9]! +
                  query[d + 10]! * centroidsFlat[o + 10]! + query[d + 11]! * centroidsFlat[o + 11]!
          dot3 += query[d + 12]! * centroidsFlat[o + 12]! + query[d + 13]! * centroidsFlat[o + 13]! +
                  query[d + 14]! * centroidsFlat[o + 14]! + query[d + 15]! * centroidsFlat[o + 15]!
        }

        // Handle remaining elements (for non-16-divisible dims)
        for (; d < dims; d++) {
          dot0 += query[d]! * centroidsFlat[offset + d]!
        }

        // Use precomputed inverse norms - multiplication instead of division
        const dot = dot0 + dot1 + dot2 + dot3
        const normProduct = queryNormInv * centroidNormInvs[i]!
        distances[i] = normProduct === 0 ? 1 : 1 - dot * normProduct
      }
    } else {
      // L2 - compute squared distances, take sqrt at end for selected results
      for (let i = 0; i < numCentroids; i++) {
        const offset = i * dims
        let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0
        let d = 0

        // Process 16 elements at a time with 4 accumulators
        for (; d < dimsLimit16; d += 16) {
          const o = offset + d
          const d0 = query[d]! - centroidsFlat[o]!, d1 = query[d + 1]! - centroidsFlat[o + 1]!
          const d2 = query[d + 2]! - centroidsFlat[o + 2]!, d3 = query[d + 3]! - centroidsFlat[o + 3]!
          const d4 = query[d + 4]! - centroidsFlat[o + 4]!, d5 = query[d + 5]! - centroidsFlat[o + 5]!
          const d6 = query[d + 6]! - centroidsFlat[o + 6]!, d7 = query[d + 7]! - centroidsFlat[o + 7]!
          const d8 = query[d + 8]! - centroidsFlat[o + 8]!, d9 = query[d + 9]! - centroidsFlat[o + 9]!
          const d10 = query[d + 10]! - centroidsFlat[o + 10]!, d11 = query[d + 11]! - centroidsFlat[o + 11]!
          const d12 = query[d + 12]! - centroidsFlat[o + 12]!, d13 = query[d + 13]! - centroidsFlat[o + 13]!
          const d14 = query[d + 14]! - centroidsFlat[o + 14]!, d15 = query[d + 15]! - centroidsFlat[o + 15]!

          sum0 += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3
          sum1 += d4 * d4 + d5 * d5 + d6 * d6 + d7 * d7
          sum2 += d8 * d8 + d9 * d9 + d10 * d10 + d11 * d11
          sum3 += d12 * d12 + d13 * d13 + d14 * d14 + d15 * d15
        }

        // Handle remaining elements (for non-16-divisible dims)
        for (; d < dims; d++) {
          const diff = query[d]! - centroidsFlat[offset + d]!
          sum0 += diff * diff
        }

        distances[i] = sum0 + sum1 + sum2 + sum3
      }
    }

    // Use partial sort for top-K with pre-allocated heap buffers
    const results = partialSortTopK(distances, numCentroids, effectiveK, this._heapDist!, this._heapIdx!)

    // For L2, convert squared distances to actual distances in results
    if (metric !== 'cosine') {
      for (const r of results) {
        r.distance = Math.sqrt(r.distance)
      }
    }

    return results
  }

  /**
   * Search for top-K nearest centroids
   * Note: This method is synchronous internally but returns a Promise for API consistency
   */
  search(query: Float32Array, k: number, options: CentroidSearchOptions = {}): Promise<ClusterMatch[]> {
    // All validation errors are returned as rejected promises for consistent async API
    if (!this._loaded) {
      return Promise.reject(new Error('Index not loaded. Call load() first.'))
    }

    if (query.length !== this._dimensions) {
      return Promise.reject(new Error(
        `Dimension mismatch: query has ${query.length} dimensions, index expects ${this._dimensions}`
      ))
    }

    // Validate query vector
    try {
      validateVector(query)
    } catch (e) {
      return Promise.reject(e)
    }

    // Handle k=0
    if (k <= 0) {
      return Promise.resolve([])
    }

    const metric = options.metric ?? this._metric
    const effectiveK = Math.min(k, this._numCentroids)

    const startTime = performance.now()
    const results = this._searchInternal(query, effectiveK, metric)
    const endTime = performance.now()

    // Update statistics
    this._totalSearches++
    this._totalDistanceComputations += this._numCentroids
    this._totalSearchTimeMs += endTime - startTime

    return Promise.resolve(results)
  }

  /**
   * Search with statistics
   */
  searchWithStats(
    query: Float32Array,
    k: number,
    options: CentroidSearchOptions = {}
  ): Promise<SearchWithStatsResult> {
    // All validation errors are returned as rejected promises for consistent async API
    if (!this._loaded) {
      return Promise.reject(new Error('Index not loaded. Call load() first.'))
    }

    if (query.length !== this._dimensions) {
      return Promise.reject(new Error(
        `Dimension mismatch: query has ${query.length} dimensions, index expects ${this._dimensions}`
      ))
    }

    // Validate query vector
    try {
      validateVector(query)
    } catch (e) {
      return Promise.reject(e)
    }

    // Handle k=0
    if (k <= 0) {
      return Promise.resolve({
        results: [],
        stats: {
          centroidsScanned: 0,
          searchTimeMs: 0,
          distanceComputations: 0,
        },
      })
    }

    const metric = options.metric ?? this._metric
    const effectiveK = Math.min(k, this._numCentroids)
    const numCentroids = this._numCentroids

    const startTime = performance.now()
    const results = this._searchInternal(query, effectiveK, metric)
    const endTime = performance.now()
    const searchTimeMs = endTime - startTime

    // Update cumulative statistics
    this._totalSearches++
    this._totalDistanceComputations += numCentroids
    this._totalSearchTimeMs += searchTimeMs

    return Promise.resolve({
      results,
      stats: {
        centroidsScanned: numCentroids,
        searchTimeMs,
        distanceComputations: numCentroids,
      },
    })
  }
}
