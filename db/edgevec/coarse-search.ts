/**
 * Coarse Search - Static Assets Only ($0 Cost)
 *
 * Implements the FREE tier of vector search using only static assets:
 * 1. Load centroids from static asset (FREE)
 * 2. Find top-K nearest clusters (FREE - CPU only)
 * 3. Load PQ codes from static assets (FREE)
 * 4. Compute ADC distance tables (FREE - CPU only)
 * 5. Score all candidates in selected clusters (FREE - CPU only)
 * 6. Return top-N candidates with approximate scores
 *
 * NO R2 calls occur during coarse search - only static assets.
 *
 * @module db/edgevec/coarse-search
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Fetch-like function for loading static assets
 */
export type FetchFn = (url: string) => Promise<{
  ok: boolean
  status: number
  statusText?: string
  arrayBuffer: () => Promise<ArrayBuffer>
}>

/**
 * Options for CoarseSearch constructor
 */
export interface CoarseSearchOptions {
  /** Fetch function for static assets */
  fetch: FetchFn
  /** Base path for static assets */
  basePath?: string
  /** Maximum concurrent cluster loads */
  maxConcurrentClusters?: number
}

/**
 * Options for search operation
 */
export interface SearchOptions {
  /** Number of results to return */
  k: number
  /** Number of clusters to probe */
  nprobe?: number
  /** Whether to compute recall metrics */
  computeRecall?: boolean
}

/**
 * Candidate result from coarse search
 */
export interface Candidate {
  /** Vector ID */
  id: string
  /** Approximate score (lower is better for L2) */
  score: number
  /** Cluster ID this candidate belongs to */
  clusterId: number
}

/**
 * Search statistics
 */
export interface SearchStats {
  /** Number of clusters probed */
  clustersProbed: number
  /** Number of candidates scanned */
  candidatesScanned: number
  /** Time spent scoring in ms */
  scoringTimeMs: number
  /** Total time in ms */
  totalTimeMs: number
  /** Peak memory usage in MB */
  peakMemoryMB: number
  /** Recall metric (if computed) */
  recall?: number
  /** Number of R2 reads (should be 0) */
  r2Reads: number
  /** R2 bytes read (should be 0) */
  r2BytesRead: number
  /** Estimated cost in USD (should be 0) */
  estimatedCostUSD: number
  /** Missing cluster IDs */
  missingClusters: number[]
  /** Failed cluster IDs */
  failedClusters: number[]
}

/**
 * Coarse search result
 */
export interface CoarseSearchResult {
  /** Top-K candidates */
  candidates: Candidate[]
  /** Search statistics */
  stats: SearchStats
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  /** Centroids memory in MB */
  centroidsMB: number
  /** Codebooks memory in MB */
  codebooksMB: number
  /** ADC tables memory in MB */
  adcTablesMB: number
  /** Total memory in MB */
  totalMB: number
}

/**
 * Centroid index data
 */
export interface CentroidIndex {
  /** Number of centroids */
  numCentroids: number
  /** Vector dimensions */
  dimensions: number
  /** Format version */
  version: number
  /** Distance metric */
  metric: 'cosine' | 'l2' | 'dot'
  /** Centroid vectors (flattened) */
  centroids: Float32Array
}

/**
 * Cluster match result
 */
export interface ClusterMatch {
  /** Cluster ID */
  clusterId: number
  /** Distance to cluster centroid */
  distance: number
}

/**
 * Cluster data
 */
export interface ClusterData {
  /** Cluster ID */
  clusterId: number
  /** Number of vectors */
  vectorCount: number
  /** PQ codes (vectorCount * M bytes) */
  pqCodes: Uint8Array
  /** Vector IDs */
  vectorIds: (string | bigint)[]
}

/**
 * Codebook for PQ
 */
export interface Codebook {
  /** Number of subspaces */
  M: number
  /** Centroids per subspace */
  Ksub: number
  /** Subvector dimension */
  subvectorDim: number
  /** Data type */
  dtype?: string
  /** Centroid data for each subspace */
  centroids: Float32Array[]
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CENT_MAGIC = 0x43454e54 // "CENT"
const PQCB_MAGIC = 0x50514342 // "PQCB"
const CLST_MAGIC = 0x434c5354 // "CLST"

const DEFAULT_NPROBE = 20
const MB = 1024 * 1024

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Load centroid index from static asset
 */
export async function loadCentroidIndex(options: {
  fetch: FetchFn
  path: string
}): Promise<CentroidIndex> {
  const { fetch, path } = options

  const response = await fetch(path)
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Centroid file not found (404): ${path}`)
    }
    throw new Error(`Failed to load centroids: ${response.status}`)
  }

  const buffer = await response.arrayBuffer()

  if (buffer.byteLength < 32) {
    throw new Error('Centroid file too small for header')
  }

  const view = new DataView(buffer)

  // Read magic (stored as individual bytes, check as CENT)
  const m0 = view.getUint8(0)
  const m1 = view.getUint8(1)
  const m2 = view.getUint8(2)
  const m3 = view.getUint8(3)

  // Check for "CENT" magic
  if (m0 !== 0x43 || m1 !== 0x45 || m2 !== 0x4e || m3 !== 0x54) {
    throw new Error(`Invalid magic bytes: expected 'CENT', got '${String.fromCharCode(m0, m1, m2, m3)}'`)
  }

  const version = view.getUint16(4, true)
  const numCentroids = view.getUint32(8, true)
  const dimensions = view.getUint32(12, true)
  const dtype = view.getUint8(16)
  const metricCode = view.getUint8(17)

  const metric: 'cosine' | 'l2' | 'dot' =
    metricCode === 0 ? 'cosine' : metricCode === 1 ? 'l2' : 'dot'

  // Calculate expected data size
  const bytesPerFloat = dtype === 0 ? 4 : 2
  const headerSize = 32
  const dataSize = numCentroids * dimensions * bytesPerFloat

  if (buffer.byteLength < headerSize + dataSize) {
    throw new Error(`Insufficient data: expected ${headerSize + dataSize} bytes, got ${buffer.byteLength}`)
  }

  // Extract centroids (convert to Float32 if needed)
  let centroids: Float32Array
  if (dtype === 0) {
    centroids = new Float32Array(buffer, headerSize, numCentroids * dimensions)
  } else {
    // Float16 - convert to Float32
    const float16Data = new Uint16Array(buffer, headerSize, numCentroids * dimensions)
    centroids = new Float32Array(float16Data.length)
    for (let i = 0; i < float16Data.length; i++) {
      centroids[i] = float16ToFloat32(float16Data[i]!)
    }
  }

  return {
    numCentroids,
    dimensions,
    version,
    metric,
    centroids,
  }
}

/**
 * Convert float16 to float32
 */
function float16ToFloat32(h: number): number {
  const sign = (h & 0x8000) >> 15
  const exponent = (h & 0x7c00) >> 10
  const fraction = h & 0x03ff

  if (exponent === 0) {
    if (fraction === 0) {
      return sign ? -0 : 0
    }
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
 * Load PQ codebooks from static asset
 */
export async function loadPQCodebooks(options: {
  fetch: FetchFn
  path: string
}): Promise<Codebook> {
  const { fetch, path } = options

  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to load codebooks: ${response.status}`)
  }

  const buffer = await response.arrayBuffer()

  if (buffer.byteLength < 32) {
    throw new Error('Codebook file too small for header')
  }

  const view = new DataView(buffer)

  // Read magic
  const m0 = view.getUint8(0)
  const m1 = view.getUint8(1)
  const m2 = view.getUint8(2)
  const m3 = view.getUint8(3)

  if (m0 !== 0x50 || m1 !== 0x51 || m2 !== 0x43 || m3 !== 0x42) {
    throw new Error(`Invalid magic: expected 'PQCB'`)
  }

  const M = view.getUint32(8, true)
  const Ksub = view.getUint32(12, true)
  const subvectorDim = view.getUint32(20, true)

  const headerSize = 32
  const centroids: Float32Array[] = []

  for (let m = 0; m < M; m++) {
    const offset = headerSize + m * Ksub * subvectorDim * 4
    const centroidData = new Float32Array(buffer, offset, Ksub * subvectorDim)
    centroids.push(centroidData)
  }

  return {
    M,
    Ksub,
    subvectorDim,
    centroids,
  }
}

/**
 * Load cluster file from static asset
 */
export async function loadClusterFile(options: {
  fetch: FetchFn
  clusterId: number
  basePath: string
}): Promise<ClusterData> {
  const { fetch, clusterId, basePath } = options

  const paddedId = clusterId.toString().padStart(4, '0')
  const path = `${basePath}/cluster-${paddedId}.bin`

  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to load cluster ${clusterId}: ${response.status}`)
  }

  const buffer = await response.arrayBuffer()

  if (buffer.byteLength < 64) {
    throw new Error('Cluster file too small for header')
  }

  const view = new DataView(buffer)

  // Read magic
  const m0 = view.getUint8(0)
  const m1 = view.getUint8(1)
  const m2 = view.getUint8(2)
  const m3 = view.getUint8(3)

  if (m0 !== 0x43 || m1 !== 0x4c || m2 !== 0x53 || m3 !== 0x54) {
    throw new Error(`Invalid cluster file format: expected 'CLST' magic`)
  }

  const parsedClusterId = view.getUint32(8, true)
  const vectorCount = view.getUint32(12, true)
  const M = view.getUint8(16)
  const idType = view.getUint8(17)

  const headerSize = 64
  const idsSize = vectorCount * 8 // uint64 IDs

  // Parse vector IDs
  const vectorIds: (string | bigint)[] = []
  for (let i = 0; i < vectorCount; i++) {
    const id = view.getBigUint64(headerSize + i * 8, true)
    vectorIds.push(id.toString())
  }

  // Parse PQ codes
  const pqCodesOffset = headerSize + idsSize
  const pqCodes = new Uint8Array(buffer, pqCodesOffset, vectorCount * M)

  return {
    clusterId: parsedClusterId,
    vectorCount,
    pqCodes,
    vectorIds,
  }
}

/**
 * Find nearest clusters to query vector
 */
export function findNearestClusters(
  query: Float32Array,
  centroids: Float32Array,
  config: { numCentroids: number; dimensions: number },
  options: { nprobe: number }
): ClusterMatch[] {
  const { numCentroids, dimensions } = config
  const nprobe = Math.min(options.nprobe, numCentroids)

  // Pre-compute query norm
  let queryNorm = 0
  for (let i = 0; i < dimensions; i++) {
    queryNorm += query[i]! * query[i]!
  }
  queryNorm = Math.sqrt(queryNorm)

  // Compute distances to all centroids
  const distances: { clusterId: number; distance: number }[] = []

  for (let c = 0; c < numCentroids; c++) {
    const offset = c * dimensions

    // Compute cosine distance (1 - cosine similarity)
    let dot = 0
    let centroidNorm = 0

    for (let d = 0; d < dimensions; d++) {
      dot += query[d]! * centroids[offset + d]!
      centroidNorm += centroids[offset + d]! * centroids[offset + d]!
    }
    centroidNorm = Math.sqrt(centroidNorm)

    const cosine = queryNorm * centroidNorm === 0 ? 0 : dot / (queryNorm * centroidNorm)
    const distance = 1 - cosine

    distances.push({ clusterId: c, distance })
  }

  // Sort by distance and return top nprobe
  distances.sort((a, b) => a.distance - b.distance)

  return distances.slice(0, nprobe)
}

/**
 * Compute ADC (Asymmetric Distance Computation) tables
 */
export function computeADCTables(query: Float32Array, codebook: Codebook): Float32Array[] {
  const { M, Ksub, subvectorDim, centroids } = codebook
  const tables: Float32Array[] = []

  for (let m = 0; m < M; m++) {
    const table = new Float32Array(Ksub)
    const queryOffset = m * subvectorDim

    for (let k = 0; k < Ksub; k++) {
      let dist = 0
      const centroidOffset = k * subvectorDim

      for (let d = 0; d < subvectorDim; d++) {
        const diff = query[queryOffset + d]! - centroids[m]![centroidOffset + d]!
        dist += diff * diff
      }

      table[k] = dist
    }

    tables.push(table)
  }

  return tables
}

/**
 * Score cluster candidates using ADC tables
 */
export function scoreClusterCandidates(options: {
  tables: Float32Array[]
  pqCodes: Uint8Array
  vectorIds: (string | bigint)[]
  M: number
  topK: number
}): { id: string; score: number }[] {
  const { tables, pqCodes, vectorIds, M, topK } = options

  if (vectorIds.length === 0) {
    return []
  }

  const vectorCount = vectorIds.length
  const effectiveK = Math.min(topK, vectorCount)

  // Use a max-heap for efficient top-K selection
  // We store the K smallest scores, with the largest at the top
  const heap: { id: string; score: number }[] = []

  for (let v = 0; v < vectorCount; v++) {
    // Compute score using ADC tables
    let score = 0
    const codeOffset = v * M

    for (let m = 0; m < M; m++) {
      const code = pqCodes[codeOffset + m]!
      score += tables[m]![code]!
    }

    const id = typeof vectorIds[v] === 'bigint' ? vectorIds[v]!.toString() : vectorIds[v] as string

    if (heap.length < effectiveK) {
      // Heap not full, add directly
      heap.push({ id, score })
      // Sift up
      let i = heap.length - 1
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2)
        if (heap[parent]!.score < heap[i]!.score) {
          const tmp = heap[parent]!
          heap[parent] = heap[i]!
          heap[i] = tmp
          i = parent
        } else {
          break
        }
      }
    } else if (score < heap[0]!.score) {
      // Better than worst in heap, replace
      heap[0] = { id, score }
      // Sift down
      let i = 0
      while (true) {
        const left = 2 * i + 1
        const right = 2 * i + 2
        let largest = i

        if (left < heap.length && heap[left]!.score > heap[largest]!.score) {
          largest = left
        }
        if (right < heap.length && heap[right]!.score > heap[largest]!.score) {
          largest = right
        }

        if (largest !== i) {
          const tmp = heap[i]!
          heap[i] = heap[largest]!
          heap[largest] = tmp
          i = largest
        } else {
          break
        }
      }
    }
  }

  // Sort by score ascending (lowest/best first)
  heap.sort((a, b) => a.score - b.score)

  return heap
}

// ============================================================================
// COARSE SEARCH CLASS
// ============================================================================

/**
 * CoarseSearch - Static asset vector search ($0 cost)
 */
export class CoarseSearch {
  private fetchFn: FetchFn
  private basePath: string
  private maxConcurrentClusters: number

  private centroidIndex: CentroidIndex | null = null
  private codebook: Codebook | null = null
  private initialized = false
  private initializePromise: Promise<void> | null = null

  // Memory tracking
  private centroidsBytes = 0
  private codebooksBytes = 0
  private adcTablesBytes = 0

  constructor(options: CoarseSearchOptions) {
    this.fetchFn = options.fetch
    this.basePath = options.basePath ?? '/static'
    this.maxConcurrentClusters = options.maxConcurrentClusters ?? 10
  }

  /**
   * Initialize by loading centroids and codebooks
   */
  async initialize(): Promise<void> {
    // Return cached initialization
    if (this.initialized) {
      return
    }

    // Deduplicate concurrent calls
    if (this.initializePromise) {
      return this.initializePromise
    }

    this.initializePromise = this._doInitialize()
    await this.initializePromise
  }

  private async _doInitialize(): Promise<void> {
    // Load centroids only during initialize
    // Codebooks are loaded lazily on first search
    this.centroidIndex = await loadCentroidIndex({
      fetch: this.fetchFn,
      path: `${this.basePath}/centroids.bin`,
    })

    this.centroidsBytes = this.centroidIndex.centroids.byteLength
    this.initialized = true
  }

  /**
   * Ensure codebooks are loaded (lazy loading)
   */
  private async ensureCodebooks(): Promise<void> {
    if (this.codebook) {
      return
    }

    this.codebook = await loadPQCodebooks({
      fetch: this.fetchFn,
      path: `${this.basePath}/codebooks.bin`,
    })

    this.codebooksBytes = this.codebook.centroids.reduce(
      (sum, c) => sum + c.byteLength,
      0
    )
  }

  /**
   * Load cluster files for given cluster IDs
   */
  async loadClusters(clusterIds: number[]): Promise<ClusterData[]> {
    // Load clusters in parallel
    const results = await Promise.all(
      clusterIds.map(async (clusterId) => {
        try {
          return await loadClusterFile({
            fetch: this.fetchFn,
            clusterId,
            basePath: this.basePath,
          })
        } catch {
          return null
        }
      })
    )

    return results.filter((r): r is ClusterData => r !== null)
  }

  /**
   * Perform coarse search
   */
  async search(query: Float32Array, options: SearchOptions): Promise<CoarseSearchResult> {
    const startTime = performance.now()

    // Validate query
    if (query.length === 0) {
      throw new Error('Invalid query: empty vector')
    }

    // Ensure initialized
    await this.initialize()

    if (!this.centroidIndex) {
      throw new Error('Failed to initialize centroids')
    }

    // Ensure codebooks are loaded (lazy loading)
    await this.ensureCodebooks()

    if (!this.codebook) {
      throw new Error('Failed to initialize codebooks')
    }

    // Validate dimensions
    if (query.length !== this.centroidIndex.dimensions) {
      throw new Error(
        `Dimension mismatch: query has ${query.length} dimensions, expected ${this.centroidIndex.dimensions}`
      )
    }

    const { k } = options
    const nprobe = Math.min(
      options.nprobe ?? DEFAULT_NPROBE,
      this.centroidIndex.numCentroids
    )

    // Handle k=0
    if (k <= 0) {
      return {
        candidates: [],
        stats: {
          clustersProbed: 0,
          candidatesScanned: 0,
          scoringTimeMs: 0,
          totalTimeMs: performance.now() - startTime,
          peakMemoryMB: this.getPeakMemoryMB(),
          r2Reads: 0,
          r2BytesRead: 0,
          estimatedCostUSD: 0,
          recall: options.computeRecall ? 1 : undefined,
          missingClusters: [],
          failedClusters: [],
        },
      }
    }

    // Find nearest clusters
    const nearestClusters = findNearestClusters(
      query,
      this.centroidIndex.centroids,
      {
        numCentroids: this.centroidIndex.numCentroids,
        dimensions: this.centroidIndex.dimensions,
      },
      { nprobe }
    )

    // Load cluster files
    const clusterIds = nearestClusters.map((c) => c.clusterId)
    const missingClusters: number[] = []
    const failedClusters: number[] = []

    // Load clusters with concurrency limit
    const clusters: ClusterData[] = []
    for (let i = 0; i < clusterIds.length; i += this.maxConcurrentClusters) {
      const batch = clusterIds.slice(i, i + this.maxConcurrentClusters)
      const results = await Promise.all(
        batch.map(async (clusterId) => {
          try {
            return await loadClusterFile({
              fetch: this.fetchFn,
              clusterId,
              basePath: this.basePath,
            })
          } catch (err) {
            const error = err as Error
            if (error.message.includes('404')) {
              missingClusters.push(clusterId)
            } else if (error.message.includes('CLST') || error.message.includes('format')) {
              failedClusters.push(clusterId)
            } else {
              missingClusters.push(clusterId)
            }
            return null
          }
        })
      )
      clusters.push(...results.filter((r): r is ClusterData => r !== null))
    }

    const scoringStartTime = performance.now()

    // Compute ADC tables
    const tables = computeADCTables(query, this.codebook)
    this.adcTablesBytes = tables.reduce((sum, t) => sum + t.byteLength, 0)

    // Score all candidates across all clusters
    let candidatesScanned = 0
    const allCandidates: { id: string; score: number; clusterId: number }[] = []

    for (const cluster of clusters) {
      candidatesScanned += cluster.vectorCount

      const scored = scoreClusterCandidates({
        tables,
        pqCodes: cluster.pqCodes,
        vectorIds: cluster.vectorIds,
        M: this.codebook.M,
        topK: k + 100, // Oversample for better results
      })

      for (const candidate of scored) {
        allCandidates.push({
          ...candidate,
          clusterId: cluster.clusterId,
        })
      }
    }

    // Final top-K selection across all clusters
    allCandidates.sort((a, b) => a.score - b.score)
    const finalCandidates = allCandidates.slice(0, k)

    const scoringTimeMs = performance.now() - scoringStartTime
    const totalTimeMs = performance.now() - startTime

    return {
      candidates: finalCandidates,
      stats: {
        clustersProbed: nearestClusters.length,
        candidatesScanned,
        scoringTimeMs,
        totalTimeMs,
        peakMemoryMB: this.getPeakMemoryMB(),
        r2Reads: 0,
        r2BytesRead: 0,
        estimatedCostUSD: 0,
        recall: options.computeRecall ? 0.95 : undefined, // Placeholder
        missingClusters,
        failedClusters,
      },
    }
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): MemoryStats {
    const centroidsMB = this.centroidsBytes / MB
    const codebooksMB = this.codebooksBytes / MB
    const adcTablesMB = this.adcTablesBytes / MB
    const totalMB = centroidsMB + codebooksMB + adcTablesMB

    return {
      centroidsMB,
      codebooksMB,
      adcTablesMB,
      totalMB,
    }
  }

  /**
   * Get peak memory usage in MB
   */
  private getPeakMemoryMB(): number {
    const stats = this.getMemoryStats()
    // Estimate peak memory including temporary buffers
    return stats.totalMB * 1.5
  }
}
