/**
 * Static Assets Search Coordinator
 *
 * Orchestrates the full vector search pipeline using static assets architecture:
 * 1. Coarse search via static assets ($0 cost) - find candidate vectors
 * 2. Rerank via R2 fetch (cheap) - get exact scores for top candidates
 * 3. Return final top-K with exact scores
 *
 * Key features:
 * - Timeout handling with partial results
 * - Partial failure handling (some vectors unavailable)
 * - Configurable oversample and nprobe
 * - Skip rerank for approximate-only results
 * - Namespace/metadata filtering
 * - Timing breakdown and metrics tracking
 *
 * @module db/vector/static-search-coordinator
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Candidate from coarse search
 */
export interface CoarseCandidate {
  /** Vector ID */
  id: string
  /** Approximate score from coarse search */
  approximateScore: number
  /** Cluster ID the vector belongs to */
  clusterId: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Search filter options
 */
export interface SearchFilter {
  /** Namespace to filter by */
  namespace?: string
  /** Additional metadata filters */
  metadata?: Record<string, unknown>
}

/**
 * Coarse search provider interface
 */
export interface CoarseSearchProvider {
  /** Execute coarse search */
  search(
    query: Float32Array,
    options?: {
      nprobe?: number
      oversample?: number
      filter?: SearchFilter
    }
  ): Promise<{
    candidates: CoarseCandidate[]
    clustersSearched: number
    candidatesScored: number
    searchTimeMs: number
  }>
}

/**
 * Rerank fetcher provider interface
 */
export interface RerankFetcherProvider {
  /** Fetch full vectors for reranking */
  fetch(ids: string[]): Promise<{
    vectors: Map<string, Float32Array>
    failed: string[]
    r2Calls: number
    fetchTimeMs: number
  }>
}

/**
 * Search result item
 */
export interface StaticSearchResultItem {
  /** Vector ID */
  id: string
  /** Score (exact or approximate) */
  score: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Timing breakdown for the search operation
 */
export interface TimingBreakdown {
  /** Time for coarse search in ms */
  coarseSearchMs: number
  /** Time to fetch vectors from R2 in ms */
  rerankFetchMs: number
  /** Time to compute exact scores in ms */
  rerankComputeMs: number
  /** Total end-to-end latency in ms */
  totalMs: number
}

/**
 * Search metrics
 */
export interface StaticSearchMetrics {
  /** Number of clusters searched */
  clustersSearched: number
  /** Number of candidates scored via ADC */
  candidatesScored: number
  /** Number of R2 calls made */
  r2Calls: number
  /** Number of vectors reranked with exact scores */
  vectorsReranked: number
  /** Recall metric (if computed) */
  recall?: number
}

/**
 * Static search result
 */
export interface StaticSearchResult {
  /** Search results */
  results: StaticSearchResultItem[]
  /** Timing breakdown */
  timing: TimingBreakdown
  /** Search metrics */
  metrics: StaticSearchMetrics
  /** Whether results are approximate (no reranking) */
  approximate?: boolean
  /** Whether the search timed out */
  timedOut?: boolean
  /** Phase where timeout occurred */
  timeoutPhase?: 'coarseSearch' | 'rerankFetch'
  /** Whether result is partial (some failures) */
  partial?: boolean
  /** IDs of vectors that failed to fetch */
  failedVectorIds?: string[]
  /** Whether results have mixed precision (some exact, some approximate) */
  mixedPrecision?: boolean
  /** Error message if search failed */
  error?: string
}

/**
 * Search options
 */
export interface StaticSearchOptions {
  /** Number of clusters to probe */
  nprobe?: number
  /** Number of candidates to oversample for reranking */
  oversample?: number
  /** Skip reranking (return approximate scores only) */
  skipRerank?: boolean
  /** Filter to apply */
  filter?: SearchFilter
  /** Compute recall metric */
  computeRecall?: boolean
  /** Ground truth IDs for recall computation */
  groundTruth?: string[]
}

/**
 * Configuration for static assets search coordinator
 */
export interface StaticAssetsSearchConfig {
  /** Coarse search provider */
  coarseSearch: CoarseSearchProvider
  /** Rerank fetcher provider */
  rerankFetcher: RerankFetcherProvider
  /** Vector dimensions */
  dimensions: number
  /** Default nprobe value */
  defaultNprobe?: number
  /** Default oversample value */
  defaultOversample?: number
  /** Timeout in milliseconds */
  timeoutMs?: number
  /** Fall back to approximate scores on rerank failure */
  fallbackToApproximate?: boolean
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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
 * Create a timeout promise that rejects after specified milliseconds
 */
function createTimeoutPromise<T>(ms: number, phase: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new Error(`TIMEOUT:${phase}`)
      reject(error)
    }, ms)
  })
}

// ============================================================================
// STATIC ASSETS SEARCH COORDINATOR
// ============================================================================

/**
 * Static Assets Search Coordinator
 *
 * Orchestrates vector search using static assets for coarse search
 * and R2 for exact reranking.
 */
export class StaticAssetsSearchCoordinator {
  private config: StaticAssetsSearchConfig

  constructor(config: StaticAssetsSearchConfig) {
    // Validate required providers
    if (!config.coarseSearch) {
      throw new Error('coarseSearch provider is required')
    }
    if (!config.rerankFetcher) {
      throw new Error('rerankFetcher provider is required')
    }

    this.config = {
      ...config,
      defaultNprobe: config.defaultNprobe ?? 20,
      defaultOversample: config.defaultOversample ?? 100,
      timeoutMs: config.timeoutMs ?? 5000,
      fallbackToApproximate: config.fallbackToApproximate ?? false,
    }
  }

  /**
   * Execute a vector search
   */
  async search(
    query: Float32Array,
    k: number,
    options?: StaticSearchOptions
  ): Promise<StaticSearchResult> {
    const totalStartTime = performance.now()

    // Validate inputs
    if (query.length === 0) {
      throw new Error('Invalid query: empty vector')
    }

    if (query.length !== this.config.dimensions) {
      throw new Error(
        `Dimension mismatch: query has ${query.length} dimensions, expected ${this.config.dimensions}`
      )
    }

    if (k <= 0) {
      throw new Error('k must be a positive integer')
    }

    // Initialize timing and metrics
    let coarseSearchMs = 0
    let rerankFetchMs = 0
    let rerankComputeMs = 0
    let clustersSearched = 0
    let candidatesScored = 0
    let r2Calls = 0
    let vectorsReranked = 0

    // Prepare search options
    const nprobe = options?.nprobe ?? this.config.defaultNprobe!
    const oversample = options?.oversample ?? this.config.defaultOversample!
    const skipRerank = options?.skipRerank ?? false

    // Track state
    let candidates: CoarseCandidate[] = []
    let timedOut = false
    let timeoutPhase: 'coarseSearch' | 'rerankFetch' | undefined
    let error: string | undefined
    let partial = false
    let failedVectorIds: string[] = []

    // Step 1: Coarse search
    const coarseStartTime = performance.now()
    try {
      const coarsePromise = this.config.coarseSearch.search(query, {
        nprobe,
        oversample,
        filter: options?.filter,
      })

      // Apply timeout if configured
      const coarseResult = await Promise.race([
        coarsePromise,
        createTimeoutPromise<never>(this.config.timeoutMs!, 'coarseSearch'),
      ])

      // Use timing from the provider response, fall back to measured time
      coarseSearchMs = coarseResult.searchTimeMs ?? (performance.now() - coarseStartTime)
      candidates = coarseResult.candidates
      clustersSearched = coarseResult.clustersSearched
      candidatesScored = coarseResult.candidatesScored
    } catch (err) {
      coarseSearchMs = performance.now() - coarseStartTime
      const errMessage = err instanceof Error ? err.message : String(err)

      if (errMessage.startsWith('TIMEOUT:')) {
        timedOut = true
        timeoutPhase = 'coarseSearch'
        // No candidates available, return empty results
        return {
          results: [],
          timing: {
            coarseSearchMs,
            rerankFetchMs: 0,
            rerankComputeMs: 0,
            totalMs: performance.now() - totalStartTime,
          },
          metrics: {
            clustersSearched: 0,
            candidatesScored: 0,
            r2Calls: 0,
            vectorsReranked: 0,
          },
          timedOut: true,
          timeoutPhase: 'coarseSearch',
        }
      } else {
        // Coarse search failed
        error = `Coarse search failed: ${errMessage}`
        return {
          results: [],
          timing: {
            coarseSearchMs,
            rerankFetchMs: 0,
            rerankComputeMs: 0,
            totalMs: performance.now() - totalStartTime,
          },
          metrics: {
            clustersSearched: 0,
            candidatesScored: 0,
            r2Calls: 0,
            vectorsReranked: 0,
          },
          error,
        }
      }
    }

    // Handle empty candidates
    if (candidates.length === 0) {
      return {
        results: [],
        timing: {
          coarseSearchMs,
          rerankFetchMs: 0,
          rerankComputeMs: 0,
          totalMs: performance.now() - totalStartTime,
        },
        metrics: {
          clustersSearched,
          candidatesScored: 0,
          r2Calls: 0,
          vectorsReranked: 0,
        },
      }
    }

    // If skipping rerank, return approximate results
    if (skipRerank) {
      // Sort by approximate score descending and take top k
      const sortedCandidates = [...candidates].sort(
        (a, b) => b.approximateScore - a.approximateScore
      )
      const topCandidates = sortedCandidates.slice(0, k)

      const results: StaticSearchResultItem[] = topCandidates.map((c) => ({
        id: c.id,
        score: c.approximateScore,
        metadata: c.metadata,
      }))

      return {
        results,
        timing: {
          coarseSearchMs,
          rerankFetchMs: 0,
          rerankComputeMs: 0,
          totalMs: performance.now() - totalStartTime,
        },
        metrics: {
          clustersSearched,
          candidatesScored,
          r2Calls: 0,
          vectorsReranked: 0,
        },
        approximate: true,
      }
    }

    // Step 2: Fetch vectors for reranking
    const rerankFetchStartTime = performance.now()
    const candidateIds = candidates.map((c) => c.id)
    let fetchedVectors: Map<string, Float32Array> = new Map()

    try {
      const fetchPromise = this.config.rerankFetcher.fetch(candidateIds)

      // Calculate remaining timeout
      const elapsedMs = performance.now() - totalStartTime
      const remainingMs = Math.max(0, this.config.timeoutMs! - elapsedMs)

      const fetchResult = await Promise.race([
        fetchPromise,
        createTimeoutPromise<never>(remainingMs, 'rerankFetch'),
      ])

      // Use timing from the provider response, fall back to measured time
      rerankFetchMs = fetchResult.fetchTimeMs ?? (performance.now() - rerankFetchStartTime)
      fetchedVectors = fetchResult.vectors
      failedVectorIds = fetchResult.failed
      r2Calls = fetchResult.r2Calls
    } catch (err) {
      rerankFetchMs = performance.now() - rerankFetchStartTime
      const errMessage = err instanceof Error ? err.message : String(err)

      if (errMessage.startsWith('TIMEOUT:')) {
        timedOut = true
        timeoutPhase = 'rerankFetch'

        // Return approximate results since we have coarse search results
        const sortedCandidates = [...candidates].sort(
          (a, b) => b.approximateScore - a.approximateScore
        )
        const topCandidates = sortedCandidates.slice(0, k)

        const results: StaticSearchResultItem[] = topCandidates.map((c) => ({
          id: c.id,
          score: c.approximateScore,
          metadata: c.metadata,
        }))

        return {
          results,
          timing: {
            coarseSearchMs,
            rerankFetchMs,
            rerankComputeMs: 0,
            totalMs: performance.now() - totalStartTime,
          },
          metrics: {
            clustersSearched,
            candidatesScored,
            r2Calls: 0,
            vectorsReranked: 0,
          },
          approximate: true,
          timedOut: true,
          timeoutPhase: 'rerankFetch',
        }
      } else if (this.config.fallbackToApproximate) {
        // Fall back to approximate scores
        error = errMessage

        const sortedCandidates = [...candidates].sort(
          (a, b) => b.approximateScore - a.approximateScore
        )
        const topCandidates = sortedCandidates.slice(0, k)

        const results: StaticSearchResultItem[] = topCandidates.map((c) => ({
          id: c.id,
          score: c.approximateScore,
          metadata: c.metadata,
        }))

        return {
          results,
          timing: {
            coarseSearchMs,
            rerankFetchMs,
            rerankComputeMs: 0,
            totalMs: performance.now() - totalStartTime,
          },
          metrics: {
            clustersSearched,
            candidatesScored,
            r2Calls: 0,
            vectorsReranked: 0,
          },
          approximate: true,
          error,
        }
      } else {
        throw err
      }
    }

    // Step 3: Compute exact scores
    const rerankComputeStartTime = performance.now()

    // Build scored results
    type ScoredResult = {
      id: string
      score: number
      metadata?: Record<string, unknown>
      isExact: boolean
    }
    const scoredResults: ScoredResult[] = []

    // Create candidate lookup
    const candidateLookup = new Map<string, CoarseCandidate>()
    for (const c of candidates) {
      candidateLookup.set(c.id, c)
    }

    // Score candidates with fetched vectors
    for (const candidate of candidates) {
      const vec = fetchedVectors.get(candidate.id)
      if (vec) {
        const exactScore = cosineSimilarity(query, vec)
        scoredResults.push({
          id: candidate.id,
          score: exactScore,
          metadata: candidate.metadata,
          isExact: true,
        })
        vectorsReranked++
      }
    }

    // Handle partial failures
    if (failedVectorIds.length > 0) {
      partial = true

      // If fallbackToApproximate is enabled, include failed vectors with approximate scores
      if (this.config.fallbackToApproximate) {
        for (const failedId of failedVectorIds) {
          const candidate = candidateLookup.get(failedId)
          if (candidate) {
            scoredResults.push({
              id: candidate.id,
              score: candidate.approximateScore,
              metadata: candidate.metadata,
              isExact: false,
            })
          }
        }
      }
    }

    rerankComputeMs = performance.now() - rerankComputeStartTime

    // Sort by score descending (cosine - higher is better)
    scoredResults.sort((a, b) => b.score - a.score)

    // Take top k
    const topResults = scoredResults.slice(0, k)

    // Check if we have mixed precision results
    // Mixed precision is true if the candidate pool contains both exact and approximate results
    // (even if the top-k happens to be all one type due to sorting)
    const hasExact = scoredResults.some((r) => r.isExact)
    const hasApproximate = scoredResults.some((r) => !r.isExact)
    const mixedPrecision = hasExact && hasApproximate

    // Build final results
    const results: StaticSearchResultItem[] = topResults.map((r) => ({
      id: r.id,
      score: r.score,
      metadata: r.metadata,
    }))

    // Compute recall if requested
    let recall: number | undefined
    if (options?.computeRecall && options?.groundTruth) {
      const groundTruthSet = new Set(options.groundTruth)
      const hits = results.filter((r) => groundTruthSet.has(r.id)).length
      recall = hits / options.groundTruth.length
    }

    // Compute total time - use max of wall clock time and sum of component timings
    // This handles both real timing and mocked timing scenarios
    const wallClockMs = performance.now() - totalStartTime
    const componentSumMs = coarseSearchMs + rerankFetchMs + rerankComputeMs
    const totalMs = Math.max(wallClockMs, componentSumMs)

    return {
      results,
      timing: {
        coarseSearchMs,
        rerankFetchMs,
        rerankComputeMs,
        totalMs,
      },
      metrics: {
        clustersSearched,
        candidatesScored,
        r2Calls,
        vectorsReranked,
        recall,
      },
      partial: partial || undefined,
      failedVectorIds: failedVectorIds.length > 0 ? failedVectorIds : undefined,
      mixedPrecision: mixedPrecision || undefined,
    }
  }
}
