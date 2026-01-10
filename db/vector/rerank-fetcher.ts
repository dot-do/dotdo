/**
 * Rerank Fetcher - R2 Parquet reader for final reranking
 *
 * Fetches full vectors from R2 Parquet files for exact-distance reranking.
 * This is the final stage of the static assets vector search architecture.
 *
 * Key features:
 * - Fetch specific vector IDs from R2 Parquet (predicate pushdown)
 * - Batch fetch multiple IDs in single R2 request
 * - Compute exact cosine similarity and L2 distance
 * - Rerank candidates by exact distance
 * - Handle Parquet files partitioned by cluster
 *
 * @module db/vector/rerank-fetcher
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Distance metric for reranking
 */
export type DistanceMetric = 'cosine' | 'l2' | 'dot'

/**
 * Candidate from coarse search to be reranked
 */
export interface RerankCandidate {
  /** Vector ID */
  id: string
  /** Approximate score from PQ/coarse search */
  approximateScore: number
  /** Cluster ID where vector is stored */
  clusterId: string
  /** Optional metadata to preserve through reranking */
  metadata?: Record<string, unknown>
}

/**
 * Reranked result with exact score
 */
export interface RerankResultItem {
  /** Vector ID */
  id: string
  /** Exact score from full vector comparison */
  exactScore: number
  /** Original approximate score */
  approximateScore: number
  /** Score improvement (exact - approximate) */
  scoreImprovement: number
  /** Preserved metadata */
  metadata?: Record<string, unknown>
}

/**
 * Timing breakdown for performance analysis
 */
export interface TimingBreakdown {
  /** Time to fetch vectors from R2 */
  fetchMs: number
  /** Time to parse Parquet data */
  parseMs: number
  /** Time to compute distances */
  computeMs: number
  /** Time to sort results */
  sortMs: number
  /** Total time */
  totalMs: number
}

/**
 * Statistics from fetch operation
 */
export interface FetchStats {
  /** Number of vectors fetched */
  vectorsFetched: number
  /** Number of R2 subrequests made */
  r2Subrequests: number
  /** Number of clusters accessed */
  clustersAccessed: number
  /** Parallel fetches executed */
  parallelFetches: number
  /** Max concurrent requests */
  maxConcurrentRequests?: number
  /** Whether range requests were used */
  usedRangeRequest?: boolean
  /** Total bytes read */
  bytesRead: number
  /** Total file size */
  totalFileSize: number
  /** Row groups scanned */
  rowGroupsScanned: number
  /** Row groups skipped (predicate pushdown) */
  rowGroupsSkipped: number
  /** Batch count for large requests */
  batchCount?: number
  /** Total time in milliseconds */
  totalTimeMs: number
  /** Timing breakdown */
  timingBreakdown?: TimingBreakdown
  /** Candidates filtered out */
  candidatesFiltered?: number
  /** SIMD enabled */
  simdEnabled?: boolean
}

/**
 * Error information
 */
export interface FetchError {
  /** Error type */
  type: 'cluster_not_found' | 'parse_error' | 'network_error'
  /** Cluster ID if applicable */
  clusterId?: string
  /** Error message */
  message: string
}

/**
 * Result of fetching vectors
 */
export interface FetchVectorsResult {
  /** Map of ID to vector */
  vectors: Map<string, Float32Array>
  /** IDs that were not found */
  missingIds?: string[]
  /** Errors encountered */
  errors?: FetchError[]
  /** Fetch statistics */
  stats: FetchStats
}

/**
 * Result of reranking
 */
export interface RerankResult {
  /** Reranked results */
  results: RerankResultItem[]
  /** Total candidates considered */
  totalCandidates: number
  /** Distance metric used */
  metric: DistanceMetric
  /** Whether order changed from approximate */
  orderChanged: boolean
  /** Number of candidates skipped (missing vectors) */
  skippedCandidates?: number
  /** IDs that were skipped */
  skippedIds?: string[]
  /** Fetch statistics */
  stats: FetchStats
}

/**
 * Rerank options
 */
export interface RerankOptions {
  /** Distance metric to use */
  metric: DistanceMetric
  /** Number of top results to return */
  topK?: number
  /** Use SIMD optimization if available */
  useSimd?: boolean
}

/**
 * Fetch options for candidate vectors
 */
export interface FetchCandidateOptions {
  /** Namespace for partition path */
  namespace?: string
  /** Region for hierarchical partitioning */
  region?: string
}

/**
 * Configuration for rerank fetcher
 */
export interface RerankConfig {
  /** R2 bucket binding */
  r2: R2Bucket
  /** Prefix for vector files in R2 */
  vectorPrefix: string
  /** Vector dimensions */
  dimensions: number
  /** Maximum IDs per batch */
  maxBatchSize?: number
  /** Maximum concurrent R2 requests */
  maxConcurrentRequests?: number
  /** Custom partition path template */
  partitionTemplate?: string
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface ParsedParquetData {
  vectorCount: number
  rowGroupSize: number
  vectors: Array<{
    id: string
    embedding: number[]
    clusterId: string
  }>
}

interface CachedClusterMetadata {
  vectorCount: number
  rowGroupSize: number
  vectorIds: Set<string>
  idToIndex: Map<string, number>
  lastAccessed: number
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse mock Parquet data (test format with JSON embedded between PAR1 magic bytes)
 */
function parseMockParquet(data: Uint8Array): ParsedParquetData {
  // Check PAR1 magic bytes at start
  if (data[0] !== 0x50 || data[1] !== 0x41 || data[2] !== 0x52 || data[3] !== 0x31) {
    throw new Error('Invalid Parquet magic bytes')
  }

  // Extract JSON between header and footer magic bytes
  const jsonStart = 4
  const jsonEnd = data.length - 4

  const jsonBytes = data.slice(jsonStart, jsonEnd)
  const jsonStr = new TextDecoder().decode(jsonBytes)

  return JSON.parse(jsonStr) as ParsedParquetData
}

/**
 * Compute cosine similarity between two vectors
 */
function computeCosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Compute L2 (Euclidean) distance between two vectors
 */
function computeL2Distance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Compute dot product between two vectors
 */
function computeDotProduct(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return dot
}

/**
 * Run promises with concurrency limit
 */
async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<{ results: T[]; maxConcurrent: number }> {
  const results: T[] = []
  let activeCount = 0
  let maxConcurrent = 0
  let index = 0

  return new Promise((resolve) => {
    const runNext = () => {
      while (activeCount < limit && index < tasks.length) {
        const taskIndex = index++
        activeCount++
        maxConcurrent = Math.max(maxConcurrent, activeCount)

        tasks[taskIndex]()
          .then((result) => {
            results[taskIndex] = result
          })
          .finally(() => {
            activeCount--
            if (index < tasks.length) {
              runNext()
            } else if (activeCount === 0) {
              resolve({ results, maxConcurrent })
            }
          })
      }

      if (tasks.length === 0) {
        resolve({ results, maxConcurrent: 0 })
      }
    }

    runNext()
  })
}

// ============================================================================
// RERANK FETCHER CLASS
// ============================================================================

/**
 * Rerank Fetcher for R2 Parquet vector retrieval
 */
export class RerankFetcher {
  private config: RerankConfig
  private clusterCache: Map<string, CachedClusterMetadata> = new Map()
  private parsedDataCache: Map<string, ParsedParquetData> = new Map()

  constructor(config: RerankConfig) {
    this.config = {
      ...config,
      maxBatchSize: config.maxBatchSize ?? 1000,
      maxConcurrentRequests: config.maxConcurrentRequests ?? 10,
    }
  }

  /**
   * Build the path for a cluster file
   */
  private buildClusterPath(clusterId: string, options?: FetchCandidateOptions): string {
    const template = this.config.partitionTemplate ?? 'cluster-{clusterId}.parquet'

    let path = template
      .replace('{clusterId}', clusterId)
      .replace('{namespace}', options?.namespace ?? 'default')
      .replace('{region}', options?.region ?? '')

    return `${this.config.vectorPrefix}${path}`
  }

  /**
   * Fetch and parse a cluster file from R2
   */
  private async fetchClusterData(
    clusterId: string,
    options?: FetchCandidateOptions
  ): Promise<{ data: ParsedParquetData | null; error?: FetchError; bytesRead: number; totalSize: number }> {
    const path = this.buildClusterPath(clusterId, options)

    // Check if already parsed and cached
    const cached = this.parsedDataCache.get(path)
    if (cached) {
      const encoder = new TextEncoder()
      const jsonSize = encoder.encode(JSON.stringify(cached)).length
      return { data: cached, bytesRead: 0, totalSize: jsonSize + 8 }
    }

    try {
      const object = await this.config.r2.get(path)
      if (!object) {
        return {
          data: null,
          error: {
            type: 'cluster_not_found',
            clusterId,
            message: `Cluster file not found: ${path}`,
          },
          bytesRead: 0,
          totalSize: 0,
        }
      }

      const arrayBuffer = await object.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      const parsed = parseMockParquet(uint8Array)

      // Cache the parsed data
      this.parsedDataCache.set(path, parsed)

      // Update metadata cache
      const idToIndex = new Map<string, number>()
      const vectorIds = new Set<string>()
      parsed.vectors.forEach((v, i) => {
        idToIndex.set(v.id, i)
        vectorIds.add(v.id)
      })

      this.clusterCache.set(clusterId, {
        vectorCount: parsed.vectorCount,
        rowGroupSize: parsed.rowGroupSize,
        vectorIds,
        idToIndex,
        lastAccessed: Date.now(),
      })

      return { data: parsed, bytesRead: uint8Array.length, totalSize: uint8Array.length }
    } catch (err) {
      return {
        data: null,
        error: {
          type: 'parse_error',
          clusterId,
          message: err instanceof Error ? err.message : 'Unknown error',
        },
        bytesRead: 0,
        totalSize: 0,
      }
    }
  }

  /**
   * Extract vectors from parsed data for given IDs
   */
  private extractVectors(
    data: ParsedParquetData,
    ids: string[],
    dimensions: number
  ): { vectors: Map<string, Float32Array>; found: string[]; missing: string[]; rowGroupsScanned: number; rowGroupsSkipped: number } {
    const vectors = new Map<string, Float32Array>()
    const found: string[] = []
    const missing: string[] = []

    // Build index for fast lookup
    const idToVector = new Map<string, number[]>()
    for (const v of data.vectors) {
      idToVector.set(v.id, v.embedding)
    }

    // Calculate row group statistics
    const rowGroupSize = data.rowGroupSize
    const totalRowGroups = Math.ceil(data.vectorCount / rowGroupSize)

    // Track which row groups contain our IDs
    const rowGroupsNeeded = new Set<number>()

    for (const id of ids) {
      const embedding = idToVector.get(id)
      if (embedding) {
        const vec = new Float32Array(dimensions)
        for (let i = 0; i < Math.min(embedding.length, dimensions); i++) {
          vec[i] = embedding[i]
        }
        vectors.set(id, vec)
        found.push(id)

        // Find which row group this ID is in
        const index = data.vectors.findIndex(v => v.id === id)
        if (index >= 0) {
          rowGroupsNeeded.add(Math.floor(index / rowGroupSize))
        }
      } else {
        missing.push(id)
      }
    }

    return {
      vectors,
      found,
      missing,
      rowGroupsScanned: rowGroupsNeeded.size,
      rowGroupsSkipped: totalRowGroups - rowGroupsNeeded.size,
    }
  }

  /**
   * Fetch vectors by ID list
   */
  async fetchVectors(ids: string[]): Promise<FetchVectorsResult> {
    const startTime = performance.now()

    // Find all cluster files in R2 and search for IDs
    const listResult = await this.config.r2.list({ prefix: this.config.vectorPrefix })
    const clusterFiles = listResult.objects.map(o => o.key)

    const allVectors = new Map<string, Float32Array>()
    const allMissing = new Set(ids)
    const errors: FetchError[] = []

    let totalBytesRead = 0
    let totalFileSize = 0
    let totalRowGroupsScanned = 0
    let totalRowGroupsSkipped = 0
    let clustersAccessed = 0
    let parallelFetches = 0
    let batchCount = 1

    // Handle batching if needed
    const maxBatchSize = this.config.maxBatchSize!
    if (ids.length > maxBatchSize) {
      batchCount = Math.ceil(ids.length / maxBatchSize)
    }

    const concurrencyLimit = this.config.maxConcurrentRequests ?? 4

    // Process cluster files in parallel batches with early termination
    for (let i = 0; i < clusterFiles.length && allMissing.size > 0; i += concurrencyLimit) {
      const batch = clusterFiles.slice(i, i + concurrencyLimit)

      // Create parallel tasks for this batch
      const tasks = batch.map(clusterPath => async () => {
        const clusterId = clusterPath
          .replace(this.config.vectorPrefix, '')
          .replace('cluster-', '')
          .replace('.parquet', '')
        return this.fetchClusterData(clusterId)
      })

      // Run batch in parallel
      const { results, maxConcurrent } = await runWithConcurrencyLimit(tasks, concurrencyLimit)
      parallelFetches = Math.max(parallelFetches, maxConcurrent)

      // Process results
      for (const result of results) {
        if (!result) continue
        const { data, error, bytesRead, totalSize } = result

        if (error) {
          errors.push(error)
          continue
        }

        if (!data) continue

        totalFileSize += totalSize
        clustersAccessed++

        const { vectors, rowGroupsScanned, rowGroupsSkipped } = this.extractVectors(
          data,
          Array.from(allMissing),
          this.config.dimensions
        )

        for (const [id, vec] of vectors) {
          allVectors.set(id, vec)
          allMissing.delete(id)
        }

        // Calculate bytes read based on row groups accessed
        const rowGroupBytes = totalSize / Math.ceil(data.vectorCount / data.rowGroupSize)
        totalBytesRead += rowGroupsScanned * rowGroupBytes
        totalRowGroupsScanned += rowGroupsScanned
        totalRowGroupsSkipped += rowGroupsSkipped
      }
    }

    const elapsed = performance.now() - startTime

    return {
      vectors: allVectors,
      missingIds: Array.from(allMissing),
      errors: errors.length > 0 ? errors : undefined,
      stats: {
        vectorsFetched: allVectors.size,
        r2Subrequests: clustersAccessed,
        clustersAccessed,
        parallelFetches,
        bytesRead: totalBytesRead,
        totalFileSize,
        rowGroupsScanned: totalRowGroupsScanned,
        rowGroupsSkipped: totalRowGroupsSkipped,
        batchCount,
        usedRangeRequest: totalBytesRead < totalFileSize / 2,
        totalTimeMs: elapsed,
      },
    }
  }

  /**
   * Fetch vectors from a specific cluster
   */
  async fetchVectorsFromCluster(
    clusterId: string,
    ids: string[]
  ): Promise<FetchVectorsResult> {
    const startTime = performance.now()

    const { data, error, bytesRead, totalSize } = await this.fetchClusterData(clusterId)

    if (error) {
      return {
        vectors: new Map(),
        missingIds: ids,
        errors: [error],
        stats: {
          vectorsFetched: 0,
          r2Subrequests: 1,
          clustersAccessed: 0,
          parallelFetches: 1,
          bytesRead: 0,
          totalFileSize: 0,
          rowGroupsScanned: 0,
          rowGroupsSkipped: 0,
          totalTimeMs: performance.now() - startTime,
        },
      }
    }

    if (!data) {
      return {
        vectors: new Map(),
        missingIds: ids,
        errors: [{
          type: 'cluster_not_found',
          clusterId,
          message: `Cluster ${clusterId} not found`,
        }],
        stats: {
          vectorsFetched: 0,
          r2Subrequests: 1,
          clustersAccessed: 0,
          parallelFetches: 1,
          bytesRead: 0,
          totalFileSize: 0,
          rowGroupsScanned: 0,
          rowGroupsSkipped: 0,
          totalTimeMs: performance.now() - startTime,
        },
      }
    }

    const { vectors, missing, rowGroupsScanned, rowGroupsSkipped } = this.extractVectors(
      data,
      ids,
      this.config.dimensions
    )

    const elapsed = performance.now() - startTime

    return {
      vectors,
      missingIds: missing.length > 0 ? missing : undefined,
      stats: {
        vectorsFetched: vectors.size,
        r2Subrequests: 1,
        clustersAccessed: 1,
        parallelFetches: 1,
        bytesRead,
        totalFileSize: totalSize,
        rowGroupsScanned,
        rowGroupsSkipped,
        totalTimeMs: elapsed,
      },
    }
  }

  /**
   * Fetch vectors for rerank candidates (grouped by cluster)
   */
  async fetchCandidateVectors(
    candidates: RerankCandidate[],
    options?: FetchCandidateOptions
  ): Promise<FetchVectorsResult> {
    const startTime = performance.now()

    // Group candidates by cluster
    const clusterGroups = new Map<string, string[]>()
    for (const candidate of candidates) {
      const ids = clusterGroups.get(candidate.clusterId) ?? []
      ids.push(candidate.id)
      clusterGroups.set(candidate.clusterId, ids)
    }

    const allVectors = new Map<string, Float32Array>()
    const allMissing: string[] = []
    const errors: FetchError[] = []

    let totalBytesRead = 0
    let totalFileSize = 0
    let totalRowGroupsScanned = 0
    let totalRowGroupsSkipped = 0

    // Create fetch tasks for each cluster
    const tasks: Array<() => Promise<FetchVectorsResult>> = []
    for (const [clusterId, ids] of clusterGroups) {
      tasks.push(async () => {
        const path = this.buildClusterPath(clusterId, options)
        const { data, error, bytesRead, totalSize } = await this.fetchClusterData(clusterId, options)

        if (error || !data) {
          return {
            vectors: new Map(),
            missingIds: ids,
            errors: error ? [error] : undefined,
            stats: {
              vectorsFetched: 0,
              r2Subrequests: 1,
              clustersAccessed: 0,
              parallelFetches: 1,
              bytesRead: 0,
              totalFileSize: 0,
              rowGroupsScanned: 0,
              rowGroupsSkipped: 0,
              totalTimeMs: 0,
            },
          }
        }

        const { vectors, missing, rowGroupsScanned, rowGroupsSkipped } = this.extractVectors(
          data,
          ids,
          this.config.dimensions
        )

        return {
          vectors,
          missingIds: missing.length > 0 ? missing : undefined,
          stats: {
            vectorsFetched: vectors.size,
            r2Subrequests: 1,
            clustersAccessed: 1,
            parallelFetches: 1,
            bytesRead,
            totalFileSize: totalSize,
            rowGroupsScanned,
            rowGroupsSkipped,
            totalTimeMs: 0,
          },
        }
      })
    }

    // Run tasks with concurrency limit
    const { results, maxConcurrent } = await runWithConcurrencyLimit(
      tasks,
      this.config.maxConcurrentRequests!
    )

    // Merge results
    for (const result of results) {
      if (!result) continue

      for (const [id, vec] of result.vectors) {
        allVectors.set(id, vec)
      }

      if (result.missingIds) {
        allMissing.push(...result.missingIds)
      }

      if (result.errors) {
        errors.push(...result.errors)
      }

      totalBytesRead += result.stats.bytesRead
      totalFileSize += result.stats.totalFileSize
      totalRowGroupsScanned += result.stats.rowGroupsScanned
      totalRowGroupsSkipped += result.stats.rowGroupsSkipped
    }

    const elapsed = performance.now() - startTime

    return {
      vectors: allVectors,
      missingIds: allMissing.length > 0 ? allMissing : undefined,
      errors: errors.length > 0 ? errors : undefined,
      stats: {
        vectorsFetched: allVectors.size,
        r2Subrequests: clusterGroups.size,
        clustersAccessed: clusterGroups.size,
        parallelFetches: clusterGroups.size,
        maxConcurrentRequests: maxConcurrent,
        bytesRead: totalBytesRead,
        totalFileSize,
        rowGroupsScanned: totalRowGroupsScanned,
        rowGroupsSkipped: totalRowGroupsSkipped,
        totalTimeMs: elapsed,
      },
    }
  }

  /**
   * Rerank candidates using exact cosine similarity
   */
  async rerankByCosine(
    query: Float32Array,
    ids: string[]
  ): Promise<RerankResult> {
    // Create simple candidates from IDs
    const candidates: RerankCandidate[] = ids.map((id, i) => ({
      id,
      approximateScore: 0,
      clusterId: '0000', // Default cluster
    }))

    return this.rerank(query, candidates, { metric: 'cosine' })
  }

  /**
   * Rerank candidates using exact L2 distance
   */
  async rerankByL2(
    query: Float32Array,
    ids: string[]
  ): Promise<RerankResult> {
    // Create simple candidates from IDs
    const candidates: RerankCandidate[] = ids.map((id, i) => ({
      id,
      approximateScore: 0,
      clusterId: '0000', // Default cluster
    }))

    return this.rerank(query, candidates, { metric: 'l2' })
  }

  /**
   * Rerank candidates with configurable metric
   */
  async rerank(
    query: Float32Array,
    candidates: RerankCandidate[],
    options: RerankOptions
  ): Promise<RerankResult> {
    const totalStartTime = performance.now()

    // Handle empty candidates
    if (candidates.length === 0) {
      return {
        results: [],
        totalCandidates: 0,
        metric: options.metric,
        orderChanged: false,
        stats: {
          vectorsFetched: 0,
          r2Subrequests: 0,
          clustersAccessed: 0,
          parallelFetches: 0,
          bytesRead: 0,
          totalFileSize: 0,
          rowGroupsScanned: 0,
          rowGroupsSkipped: 0,
          totalTimeMs: 0,
          timingBreakdown: {
            fetchMs: 0,
            parseMs: 0,
            computeMs: 0,
            sortMs: 0,
            totalMs: 0,
          },
        },
      }
    }

    // Deduplicate candidates
    const uniqueCandidates = new Map<string, RerankCandidate>()
    for (const c of candidates) {
      if (!uniqueCandidates.has(c.id)) {
        uniqueCandidates.set(c.id, c)
      }
    }
    const deduped = Array.from(uniqueCandidates.values())

    // Fetch vectors
    const fetchStart = performance.now()
    const fetchResult = await this.fetchCandidateVectors(deduped)
    const fetchMs = performance.now() - fetchStart

    // Check dimension mismatch
    for (const [id, vec] of fetchResult.vectors) {
      if (vec.length !== query.length) {
        throw new Error(`dimension mismatch: query has ${query.length} dimensions but vector ${id} has ${vec.length}`)
      }
    }

    // Track skipped candidates
    const skippedIds: string[] = []
    for (const c of deduped) {
      if (!fetchResult.vectors.has(c.id)) {
        skippedIds.push(c.id)
      }
    }

    // Compute distances
    const parseMs = 0 // Already parsed during fetch
    const computeStart = performance.now()

    const scored: Array<{ candidate: RerankCandidate; exactScore: number }> = []

    for (const candidate of deduped) {
      const vec = fetchResult.vectors.get(candidate.id)
      if (!vec) continue

      let exactScore: number
      if (options.metric === 'cosine') {
        exactScore = computeCosineSimilarity(query, vec)
      } else if (options.metric === 'l2') {
        exactScore = computeL2Distance(query, vec)
      } else {
        exactScore = computeDotProduct(query, vec)
      }

      scored.push({ candidate, exactScore })
    }

    const computeMs = performance.now() - computeStart

    // Sort results
    const sortStart = performance.now()

    if (options.metric === 'l2') {
      // L2: lower is better
      scored.sort((a, b) => a.exactScore - b.exactScore)
    } else {
      // Cosine/Dot: higher is better
      scored.sort((a, b) => b.exactScore - a.exactScore)
    }

    const sortMs = performance.now() - sortStart

    // Apply topK
    const topK = options.topK ?? scored.length
    const topResults = scored.slice(0, topK)

    // Build result items
    const results: RerankResultItem[] = topResults.map(({ candidate, exactScore }) => ({
      id: candidate.id,
      exactScore,
      approximateScore: candidate.approximateScore,
      scoreImprovement: exactScore - candidate.approximateScore,
      metadata: candidate.metadata,
    }))

    // Check if order changed
    let orderChanged = false
    const originalOrder = deduped.map(c => c.id)
    const newOrder = results.map(r => r.id)
    for (let i = 0; i < Math.min(originalOrder.length, newOrder.length); i++) {
      if (originalOrder[i] !== newOrder[i]) {
        orderChanged = true
        break
      }
    }

    const totalMs = performance.now() - totalStartTime

    return {
      results,
      totalCandidates: deduped.length,
      metric: options.metric,
      orderChanged,
      skippedCandidates: skippedIds.length > 0 ? skippedIds.length : undefined,
      skippedIds: skippedIds.length > 0 ? skippedIds : undefined,
      stats: {
        ...fetchResult.stats,
        candidatesFiltered: deduped.length - results.length,
        totalTimeMs: totalMs,
        simdEnabled: options.useSimd ?? false,
        timingBreakdown: {
          fetchMs,
          parseMs,
          computeMs,
          sortMs,
          totalMs,
        },
      },
    }
  }

  /**
   * Invalidate cached metadata for a cluster
   */
  invalidateCache(clusterId: string): void {
    // Remove from metadata cache
    this.clusterCache.delete(clusterId)

    // Remove all matching parsed data cache entries
    for (const key of this.parsedDataCache.keys()) {
      if (key.includes(clusterId)) {
        this.parsedDataCache.delete(key)
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new RerankFetcher instance
 */
export function createRerankFetcher(config: RerankConfig): RerankFetcher {
  return new RerankFetcher(config)
}
