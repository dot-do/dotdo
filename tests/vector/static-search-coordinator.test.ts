/**
 * Static Assets Search Coordinator Tests
 *
 * TDD RED phase tests for the search coordinator that orchestrates the full
 * query flow using the Static Assets Vector Search architecture:
 *
 * Query Flow:
 * 1. Load centroids (static asset) -> FREE
 * 2. Find top-N clusters (in-memory) -> FREE
 * 3. Load PQ codes (static assets) -> FREE
 * 4. ADC scoring of candidates -> FREE (CPU only)
 * 5. Fetch top-K full vectors (R2) -> R2 read cost
 * 6. Exact rerank -> FREE (CPU only)
 *
 * The coordinator is responsible for orchestrating this pipeline efficiently,
 * handling failures, tracking metrics, and ensuring quality targets are met.
 *
 * @see docs/plans/static-assets-vector-search.md
 * @module tests/vector/static-search-coordinator.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import the static assets search coordinator (does not exist yet - RED phase)
import {
  StaticAssetsSearchCoordinator,
  type StaticAssetsSearchConfig,
  type CoarseSearchProvider,
  type RerankFetcherProvider,
  type StaticSearchResult,
  type StaticSearchMetrics,
  type TimingBreakdown,
  type CoarseCandidate,
  type SearchFilter,
} from '../../db/vector/static-search-coordinator'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a normalized unit vector
 */
function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)

  const result = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i] / norm
  }
  return result
}

/**
 * Create a random vector with optional seed for reproducibility
 */
function randomVector(dimensions: number, seed?: number): Float32Array {
  const vec = new Float32Array(dimensions)
  let s = seed ?? Math.random() * 10000
  for (let i = 0; i < dimensions; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    vec[i] = (s / 0x7fffffff) * 2 - 1
  }
  return normalizeVector(vec)
}

/**
 * Calculate cosine similarity between two vectors
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
 * Create mock coarse search provider
 */
function createMockCoarseSearchProvider(options: {
  candidates?: CoarseCandidate[]
  latencyMs?: number
  shouldFail?: boolean
  failureError?: Error
  clustersSearched?: number
  candidatesScored?: number
}): CoarseSearchProvider {
  const {
    candidates = [],
    latencyMs = 10,
    shouldFail = false,
    failureError = new Error('Coarse search failed'),
    clustersSearched = 5,
    candidatesScored = candidates.length,
  } = options

  return {
    search: vi.fn(async (query: Float32Array, options?: { nprobe?: number; oversample?: number; filter?: SearchFilter }) => {
      await new Promise(resolve => setTimeout(resolve, latencyMs))

      if (shouldFail) {
        throw failureError
      }

      let filteredCandidates = candidates
      if (options?.filter) {
        filteredCandidates = candidates.filter(c => {
          if (!c.metadata) return true
          if (options.filter!.namespace && c.metadata.namespace !== options.filter!.namespace) {
            return false
          }
          return true
        })
      }

      const limit = options?.oversample ?? 100
      return {
        candidates: filteredCandidates.slice(0, limit),
        clustersSearched,
        candidatesScored,
        searchTimeMs: latencyMs,
      }
    }),
  }
}

/**
 * Create mock rerank fetcher provider
 */
function createMockRerankFetcherProvider(options: {
  vectors?: Map<string, Float32Array>
  latencyMs?: number
  shouldFail?: boolean
  failureError?: Error
  r2Calls?: number
  partialFailure?: boolean
  failedIds?: string[]
}): RerankFetcherProvider {
  const {
    vectors = new Map(),
    latencyMs = 20,
    shouldFail = false,
    failureError = new Error('Rerank fetch failed'),
    r2Calls = 1,
    partialFailure = false,
    failedIds = [],
  } = options

  return {
    fetch: vi.fn(async (ids: string[]) => {
      await new Promise(resolve => setTimeout(resolve, latencyMs))

      if (shouldFail) {
        throw failureError
      }

      const result = new Map<string, Float32Array>()
      const failed: string[] = []

      for (const id of ids) {
        if (partialFailure && failedIds.includes(id)) {
          failed.push(id)
          continue
        }
        const vec = vectors.get(id)
        if (vec) {
          result.set(id, vec)
        } else {
          failed.push(id)
        }
      }

      return {
        vectors: result,
        failed,
        r2Calls,
        fetchTimeMs: latencyMs,
      }
    }),
  }
}

/**
 * Create test candidates with approximate scores
 */
function createTestCandidates(
  count: number,
  options: {
    prefix?: string
    baseApproxScore?: number
    scoreDecrement?: number
    withMetadata?: boolean
    namespace?: string
  } = {}
): CoarseCandidate[] {
  const {
    prefix = 'vec',
    baseApproxScore = 0.95,
    scoreDecrement = 0.005,
    withMetadata = false,
    namespace,
  } = options

  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    approximateScore: baseApproxScore - i * scoreDecrement,
    clusterId: Math.floor(i / 10),
    metadata: withMetadata ? {
      namespace: namespace ?? `ns-${i % 3}`,
      type: ['doc', 'chunk', 'entity'][i % 3],
    } : undefined,
  }))
}

/**
 * Create test vectors map for reranking
 */
function createTestVectorsMap(
  candidates: CoarseCandidate[],
  dimensions: number,
  seed: number = 0
): Map<string, Float32Array> {
  const vectors = new Map<string, Float32Array>()
  for (const candidate of candidates) {
    vectors.set(candidate.id, randomVector(dimensions, seed + parseInt(candidate.id.split('-')[1] || '0', 10)))
  }
  return vectors
}

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const TEST_DIMENSIONS = 1536

// ============================================================================
// TEST SUITE
// ============================================================================

describe('StaticAssetsSearchCoordinator', () => {
  let coordinator: StaticAssetsSearchCoordinator
  let mockCoarseSearch: CoarseSearchProvider
  let mockRerankFetcher: RerankFetcherProvider

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // TEST 1: Accept search request with query vector and k
  // ==========================================================================

  describe('should accept search request with query vector and k', () => {
    it('accepts a Float32Array query vector and k parameter', async () => {
      // Arrange
      const candidates = createTestCandidates(100)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)
      const k = 10

      // Act
      const searchPromise = coordinator.search(query, k)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert
      expect(result).toBeDefined()
      expect(result.results).toBeDefined()
      expect(result.results.length).toBeLessThanOrEqual(k)
    })

    it('validates query vector dimensions', async () => {
      // Arrange
      mockCoarseSearch = createMockCoarseSearchProvider({ candidates: [] })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors: new Map() })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const wrongDimensionQuery = randomVector(64, 999) // Wrong dimensions

      // Act & Assert
      const searchPromise = coordinator.search(wrongDimensionQuery, 10)
      await vi.advanceTimersByTimeAsync(50)

      await expect(searchPromise).rejects.toThrow(/dimension.*mismatch/i)
    })

    it('validates k is a positive integer', async () => {
      // Arrange
      mockCoarseSearch = createMockCoarseSearchProvider({ candidates: [] })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors: new Map() })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act & Assert: k = 0
      const searchPromise0 = coordinator.search(query, 0)
      await vi.advanceTimersByTimeAsync(50)
      await expect(searchPromise0).rejects.toThrow(/k.*positive/i)

      // Act & Assert: k < 0
      const searchPromiseNeg = coordinator.search(query, -5)
      await vi.advanceTimersByTimeAsync(50)
      await expect(searchPromiseNeg).rejects.toThrow(/k.*positive/i)
    })

    it('accepts optional search options (nprobe, oversample, namespace)', async () => {
      // Arrange
      const candidates = createTestCandidates(50, { withMetadata: true })
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10, {
        nprobe: 20,
        oversample: 100,
        filter: { namespace: 'ns-0' },
      })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Options were passed to coarse search
      expect(mockCoarseSearch.search).toHaveBeenCalledWith(
        query,
        expect.objectContaining({
          nprobe: 20,
          oversample: 100,
          filter: { namespace: 'ns-0' },
        })
      )
    })
  })

  // ==========================================================================
  // TEST 2: Call coarse search to get candidates
  // ==========================================================================

  describe('should call coarse search to get candidates', () => {
    it('invokes coarse search provider with query and options', async () => {
      // Arrange
      const candidates = createTestCandidates(50)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        clustersSearched: 10,
        candidatesScored: 5000,
      })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
        defaultNprobe: 15,
        defaultOversample: 100,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      await searchPromise

      // Assert
      expect(mockCoarseSearch.search).toHaveBeenCalledTimes(1)
      expect(mockCoarseSearch.search).toHaveBeenCalledWith(
        query,
        expect.objectContaining({
          nprobe: 15,
          oversample: 100,
        })
      )
    })

    it('uses coarse search results to select rerank candidates', async () => {
      // Arrange: Coarse search returns 50 candidates, we want top 10
      const candidates = createTestCandidates(50)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)
      const topCandidateIds = candidates.slice(0, 10).map(c => c.id)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
        defaultOversample: 50, // Rerank all 50 candidates
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      await searchPromise

      // Assert: Rerank fetcher was called with candidate IDs
      expect(mockRerankFetcher.fetch).toHaveBeenCalled()
      const fetchedIds = (mockRerankFetcher.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
      expect(fetchedIds.length).toBeLessThanOrEqual(50)

      // Should include the top candidates
      for (const id of topCandidateIds.slice(0, 5)) {
        expect(fetchedIds).toContain(id)
      }
    })

    it('limits coarse search candidates by oversample parameter', async () => {
      // Arrange: Many candidates available
      const candidates = createTestCandidates(500)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act: Request oversample of 100
      const searchPromise = coordinator.search(query, 10, { oversample: 100 })
      await vi.advanceTimersByTimeAsync(100)
      await searchPromise

      // Assert: Coarse search was asked for 100 candidates
      expect(mockCoarseSearch.search).toHaveBeenCalledWith(
        query,
        expect.objectContaining({ oversample: 100 })
      )
    })
  })

  // ==========================================================================
  // TEST 3: Call rerank fetcher for top candidates
  // ==========================================================================

  describe('should call rerank fetcher for top candidates', () => {
    it('fetches full vectors for top candidates from R2', async () => {
      // Arrange
      const candidates = createTestCandidates(100)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors, r2Calls: 5 })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10, { oversample: 50 })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Rerank fetcher was called
      expect(mockRerankFetcher.fetch).toHaveBeenCalledTimes(1)

      // Assert: R2 calls are tracked
      expect(result.metrics.r2Calls).toBe(5)
    })

    it('limits rerank candidates to oversample count', async () => {
      // Arrange: 500 coarse candidates, oversample 100
      const candidates = createTestCandidates(500)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10, { oversample: 100 })
      await vi.advanceTimersByTimeAsync(100)
      await searchPromise

      // Assert: Only 100 candidates fetched for reranking
      const fetchedIds = (mockRerankFetcher.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
      expect(fetchedIds.length).toBeLessThanOrEqual(100)
    })

    it('computes exact scores using fetched full vectors', async () => {
      // Arrange: Create candidates with known vectors
      const candidates = createTestCandidates(10)
      const vectors = new Map<string, Float32Array>()

      // Create specific vectors so we can verify exact scores
      const query = randomVector(TEST_DIMENSIONS, 999)
      for (let i = 0; i < 10; i++) {
        const vec = randomVector(TEST_DIMENSIONS, i * 100)
        vectors.set(candidates[i].id, vec)
      }

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      // Act
      const searchPromise = coordinator.search(query, 5)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Results have exact scores computed from full vectors
      expect(result.results.length).toBe(5)
      for (const r of result.results) {
        const vec = vectors.get(r.id)
        expect(vec).toBeDefined()
        // Score should match exact cosine similarity
        const expectedScore = cosineSimilarity(query, vec!)
        expect(r.score).toBeCloseTo(expectedScore, 5)
      }
    })
  })

  // ==========================================================================
  // TEST 4: Return final results with exact scores
  // ==========================================================================

  describe('should return final results with exact scores', () => {
    it('returns results sorted by exact score (descending for cosine)', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Results are sorted by score descending
      for (let i = 0; i < result.results.length - 1; i++) {
        expect(result.results[i].score).toBeGreaterThanOrEqual(result.results[i + 1].score)
      }
    })

    it('returns exactly k results when enough candidates available', async () => {
      // Arrange
      const candidates = createTestCandidates(100)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)
      const k = 25

      // Act
      const searchPromise = coordinator.search(query, k)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert
      expect(result.results).toHaveLength(k)
    })

    it('returns fewer than k results when not enough candidates', async () => {
      // Arrange: Only 5 candidates total
      const candidates = createTestCandidates(5)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)
      const k = 20 // Request more than available

      // Act
      const searchPromise = coordinator.search(query, k)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Returns all available (5)
      expect(result.results).toHaveLength(5)
    })

    it('includes vector ID and score in each result', async () => {
      // Arrange
      const candidates = createTestCandidates(10)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 5)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Each result has id and score
      for (const r of result.results) {
        expect(r.id).toBeDefined()
        expect(typeof r.id).toBe('string')
        expect(r.score).toBeDefined()
        expect(typeof r.score).toBe('number')
        expect(r.score).toBeGreaterThanOrEqual(-1)
        expect(r.score).toBeLessThanOrEqual(1)
      }
    })
  })

  // ==========================================================================
  // TEST 5: Include timing breakdown in response
  // ==========================================================================

  describe('should include timing breakdown in response', () => {
    it('reports coarse search timing', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates, latencyMs: 30 })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors, latencyMs: 40 })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Timing breakdown includes coarse search
      expect(result.timing).toBeDefined()
      expect(result.timing.coarseSearchMs).toBeGreaterThanOrEqual(30)
    })

    it('reports rerank fetch timing', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates, latencyMs: 10 })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors, latencyMs: 40 })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert
      expect(result.timing.rerankFetchMs).toBeGreaterThanOrEqual(40)
    })

    it('reports exact rerank computation timing', async () => {
      // Arrange
      const candidates = createTestCandidates(50)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert
      expect(result.timing.rerankComputeMs).toBeDefined()
      expect(result.timing.rerankComputeMs).toBeGreaterThanOrEqual(0)
    })

    it('reports total end-to-end latency', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates, latencyMs: 30 })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors, latencyMs: 40 })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Total should be >= sum of coarse + rerank
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(
        result.timing.coarseSearchMs + result.timing.rerankFetchMs
      )
    })

    it('includes all timing components in breakdown', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: All expected timing fields present
      const timing = result.timing as TimingBreakdown
      expect(timing.coarseSearchMs).toBeDefined()
      expect(timing.rerankFetchMs).toBeDefined()
      expect(timing.rerankComputeMs).toBeDefined()
      expect(timing.totalMs).toBeDefined()
    })
  })

  // ==========================================================================
  // TEST 6: Handle search with filters (pre-filter candidates)
  // ==========================================================================

  describe('should handle search with filters (pre-filter candidates)', () => {
    it('passes namespace filter to coarse search', async () => {
      // Arrange
      const candidates = createTestCandidates(50, { withMetadata: true })
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)
      const filter: SearchFilter = { namespace: 'production' }

      // Act
      const searchPromise = coordinator.search(query, 10, { filter })
      await vi.advanceTimersByTimeAsync(100)
      await searchPromise

      // Assert: Filter was passed to coarse search
      expect(mockCoarseSearch.search).toHaveBeenCalledWith(
        query,
        expect.objectContaining({ filter })
      )
    })

    it('only returns results matching the filter', async () => {
      // Arrange: Some candidates in target namespace, some not
      const targetNamespace = 'ns-0'
      const candidates = createTestCandidates(30, { withMetadata: true, namespace: targetNamespace })
      const otherCandidates = createTestCandidates(30, { withMetadata: true, namespace: 'ns-other', prefix: 'other' })
      const allCandidates = [...candidates, ...otherCandidates]
      const vectors = createTestVectorsMap(allCandidates, TEST_DIMENSIONS)

      // Mock coarse search to filter properly
      mockCoarseSearch = createMockCoarseSearchProvider({ candidates: allCandidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10, {
        filter: { namespace: targetNamespace },
      })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: All results should be from target namespace (based on ID prefix)
      for (const r of result.results) {
        expect(r.id).toMatch(/^vec-/) // Should be from target candidates
      }
    })

    it('returns empty results when no candidates match filter', async () => {
      // Arrange: No candidates match filter
      const candidates = createTestCandidates(20, { withMetadata: true, namespace: 'ns-a' })
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act: Filter for namespace that doesn't exist
      const searchPromise = coordinator.search(query, 10, {
        filter: { namespace: 'nonexistent' },
      })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Empty results
      expect(result.results).toHaveLength(0)
    })

    it('supports metadata filters beyond namespace', async () => {
      // Arrange
      const candidates = createTestCandidates(30, { withMetadata: true })
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)
      const filter: SearchFilter = {
        namespace: 'ns-0',
        metadata: { type: 'doc' },
      }

      // Act
      const searchPromise = coordinator.search(query, 10, { filter })
      await vi.advanceTimersByTimeAsync(100)
      await searchPromise

      // Assert: Filter was passed
      expect(mockCoarseSearch.search).toHaveBeenCalledWith(
        query,
        expect.objectContaining({ filter })
      )
    })
  })

  // ==========================================================================
  // TEST 7: Handle search without reranking (approximate only)
  // ==========================================================================

  describe('should handle search without reranking (approximate only)', () => {
    it('returns approximate scores when rerank is disabled', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act: Disable reranking
      const searchPromise = coordinator.search(query, 10, { skipRerank: true })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Results use approximate scores from coarse search
      expect(result.results.length).toBe(10)
      // Scores should match approximate scores from candidates
      for (let i = 0; i < result.results.length; i++) {
        const candidate = candidates.find(c => c.id === result.results[i].id)
        expect(candidate).toBeDefined()
        expect(result.results[i].score).toBe(candidate!.approximateScore)
      }
    })

    it('does not call rerank fetcher when rerank is disabled', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10, { skipRerank: true })
      await vi.advanceTimersByTimeAsync(100)
      await searchPromise

      // Assert: Rerank fetcher was NOT called
      expect(mockRerankFetcher.fetch).not.toHaveBeenCalled()
    })

    it('indicates approximate results in response metadata', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors: new Map() })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10, { skipRerank: true })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Response indicates approximate results
      expect(result.approximate).toBe(true)
    })

    it('reports zero rerank timing when rerank is skipped', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors: new Map() })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10, { skipRerank: true })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert
      expect(result.timing.rerankFetchMs).toBe(0)
      expect(result.timing.rerankComputeMs).toBe(0)
    })
  })

  // ==========================================================================
  // TEST 8: Handle timeout gracefully
  // ==========================================================================

  describe('should handle timeout gracefully', () => {
    it('returns partial results when coarse search times out', async () => {
      // Arrange: Coarse search takes longer than timeout
      const candidates = createTestCandidates(20)
      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        latencyMs: 5000, // 5 seconds
      })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors: new Map() })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
        timeoutMs: 100, // 100ms timeout
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(150)
      const result = await searchPromise

      // Assert: Got timeout result
      expect(result.timedOut).toBe(true)
      expect(result.results).toHaveLength(0) // No results if coarse search timed out
    })

    it('returns partial results when rerank fetch times out', async () => {
      // Arrange: Coarse fast, rerank slow
      const candidates = createTestCandidates(20)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        latencyMs: 20,
      })
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors,
        latencyMs: 5000, // 5 seconds
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
        timeoutMs: 100, // 100ms timeout
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(150)
      const result = await searchPromise

      // Assert: Got partial results (approximate from coarse search)
      expect(result.timedOut).toBe(true)
      expect(result.results.length).toBeGreaterThan(0) // Should have approximate results
      expect(result.approximate).toBe(true) // Fell back to approximate
    })

    it('respects custom timeout configuration', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        latencyMs: 300,
      })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors: new Map() })

      // Short timeout
      const shortTimeoutCoordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
        timeoutMs: 100,
      })

      // Long timeout
      const longTimeoutCoordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
        timeoutMs: 500,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act: Short timeout
      const shortPromise = shortTimeoutCoordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(150)
      const shortResult = await shortPromise

      // Reset mocks
      vi.clearAllMocks()

      // Act: Long timeout
      const longPromise = longTimeoutCoordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(400)
      const longResult = await longPromise

      // Assert
      expect(shortResult.timedOut).toBe(true)
      expect(longResult.timedOut).toBeFalsy()
    })

    it('reports timeout in response metadata', async () => {
      // Arrange
      const candidates = createTestCandidates(10)
      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        latencyMs: 500,
      })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors: new Map() })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
        timeoutMs: 100,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(150)
      const result = await searchPromise

      // Assert
      expect(result.timedOut).toBe(true)
      expect(result.timeoutPhase).toBeDefined()
      expect(['coarseSearch', 'rerankFetch']).toContain(result.timeoutPhase)
    })
  })

  // ==========================================================================
  // TEST 9: Handle partial failures (some clusters unavailable)
  // ==========================================================================

  describe('should handle partial failures (some clusters unavailable)', () => {
    it('returns results even when some vector fetches fail', async () => {
      // Arrange: Some vectors fail to fetch
      const candidates = createTestCandidates(20)
      const vectors = createTestVectorsMap(candidates.slice(0, 15), TEST_DIMENSIONS) // Only 15 of 20

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors,
        partialFailure: true,
        failedIds: candidates.slice(15, 20).map(c => c.id),
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Got results from successful fetches
      expect(result.results.length).toBeGreaterThan(0)
      expect(result.partial).toBe(true)
    })

    it('reports failed vector IDs in response metadata', async () => {
      // Arrange
      const candidates = createTestCandidates(20)
      const failedIds = ['vec-15', 'vec-16', 'vec-17']
      const vectors = createTestVectorsMap(
        candidates.filter(c => !failedIds.includes(c.id)),
        TEST_DIMENSIONS
      )

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors,
        partialFailure: true,
        failedIds,
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Failed IDs reported
      expect(result.failedVectorIds).toBeDefined()
      expect(result.failedVectorIds!.length).toBe(3)
      for (const id of failedIds) {
        expect(result.failedVectorIds).toContain(id)
      }
    })

    it('falls back to approximate scores for failed vectors', async () => {
      // Arrange: Most vectors fail, should fall back to approximate
      const candidates = createTestCandidates(20)
      const failedIds = candidates.slice(5).map(c => c.id) // 15 of 20 fail
      const vectors = createTestVectorsMap(candidates.slice(0, 5), TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors,
        partialFailure: true,
        failedIds,
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
        fallbackToApproximate: true,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Got 10 results (some exact, some approximate)
      expect(result.results).toHaveLength(10)
      expect(result.mixedPrecision).toBe(true)
    })

    it('continues with available results when coarse search partially fails', async () => {
      // Arrange: Coarse search returns partial results
      const candidates = createTestCandidates(10)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        clustersSearched: 3, // Only 3 of expected clusters
      })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Got results despite partial search
      expect(result.results.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // TEST 10: Track metrics (clusters searched, candidates scored, R2 calls)
  // ==========================================================================

  describe('should track metrics (clusters searched, candidates scored, R2 calls)', () => {
    it('reports number of clusters searched', async () => {
      // Arrange
      const candidates = createTestCandidates(50)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        clustersSearched: 15,
        candidatesScored: 75000,
      })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert
      expect(result.metrics.clustersSearched).toBe(15)
    })

    it('reports number of candidates scored (ADC)', async () => {
      // Arrange
      const candidates = createTestCandidates(100)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        clustersSearched: 20,
        candidatesScored: 500000, // 500K candidates scored via ADC
      })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert
      expect(result.metrics.candidatesScored).toBe(500000)
    })

    it('reports number of R2 calls made', async () => {
      // Arrange
      const candidates = createTestCandidates(100)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors,
        r2Calls: 8, // 8 R2 subrequests
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert
      expect(result.metrics.r2Calls).toBe(8)
    })

    it('reports number of vectors reranked', async () => {
      // Arrange
      const candidates = createTestCandidates(100)
      const vectors = createTestVectorsMap(candidates.slice(0, 50), TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10, { oversample: 50 })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert
      expect(result.metrics.vectorsReranked).toBe(50)
    })

    it('includes all metrics in response', async () => {
      // Arrange
      const candidates = createTestCandidates(30)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        clustersSearched: 10,
        candidatesScored: 50000,
      })
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors,
        r2Calls: 3,
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: All metrics present
      expect(result.metrics).toMatchObject({
        clustersSearched: expect.any(Number),
        candidatesScored: expect.any(Number),
        r2Calls: expect.any(Number),
        vectorsReranked: expect.any(Number),
      })
    })
  })

  // ==========================================================================
  // TEST 11: End-to-end latency under 150ms
  // ==========================================================================

  describe('should achieve end-to-end latency under 150ms', () => {
    it('completes typical search within 150ms', async () => {
      // Arrange: Realistic latencies
      // - Coarse search: ~40ms (static assets, ADC scoring)
      // - Rerank fetch: ~50ms (R2 reads for top 100)
      // - Rerank compute: ~5ms
      const candidates = createTestCandidates(100)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        latencyMs: 40,
        clustersSearched: 20,
        candidatesScored: 500000,
      })
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors,
        latencyMs: 50,
        r2Calls: 5,
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const startTime = Date.now()
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Total latency under 150ms (with buffer)
      expect(result.timing.totalMs).toBeLessThan(150)
    })

    it('p50 latency under 80ms target', async () => {
      // Arrange: Multiple searches to measure distribution
      const candidates = createTestCandidates(50)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        latencyMs: 30, // Fast coarse search
      })
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors,
        latencyMs: 30, // Fast rerank
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      // Act: Run 10 searches
      const latencies: number[] = []
      for (let i = 0; i < 10; i++) {
        const query = randomVector(TEST_DIMENSIONS, i)
        const searchPromise = coordinator.search(query, 10)
        await vi.advanceTimersByTimeAsync(100)
        const result = await searchPromise
        latencies.push(result.timing.totalMs)
      }

      // Calculate p50
      latencies.sort((a, b) => a - b)
      const p50 = latencies[Math.floor(latencies.length * 0.5)]

      // Assert: p50 under 80ms
      expect(p50).toBeLessThan(80)
    })

    it('p99 latency under 150ms target', async () => {
      // Arrange: Some searches will be slower
      const candidates = createTestCandidates(50)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)

      // Variable latency to simulate real-world conditions
      let callCount = 0
      mockCoarseSearch = {
        search: vi.fn(async () => {
          const latency = callCount++ % 10 === 0 ? 60 : 30 // Every 10th is slower
          await new Promise(resolve => setTimeout(resolve, latency))
          return {
            candidates,
            clustersSearched: 10,
            candidatesScored: 50000,
            searchTimeMs: latency,
          }
        }),
      }
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors,
        latencyMs: 40,
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      // Act: Run 20 searches
      const latencies: number[] = []
      for (let i = 0; i < 20; i++) {
        const query = randomVector(TEST_DIMENSIONS, i)
        const searchPromise = coordinator.search(query, 10)
        await vi.advanceTimersByTimeAsync(120)
        const result = await searchPromise
        latencies.push(result.timing.totalMs)
      }

      // Calculate p99
      latencies.sort((a, b) => a - b)
      const p99 = latencies[Math.floor(latencies.length * 0.99)]

      // Assert: p99 under 150ms
      expect(p99).toBeLessThan(150)
    })
  })

  // ==========================================================================
  // TEST 12: Verify 95%+ recall@100 vs exact search
  // ==========================================================================

  describe('should verify 95%+ recall@100 vs exact search', () => {
    it('achieves 95%+ recall@100 against ground truth', async () => {
      // Arrange: Create a set of vectors with known ground truth
      const vectorCount = 1000
      const dimensions = 128 // Smaller for faster test
      const testVectors: Float32Array[] = []
      const testIds: string[] = []

      for (let i = 0; i < vectorCount; i++) {
        testVectors.push(randomVector(dimensions, i))
        testIds.push(`vec-${i}`)
      }

      // Create query
      const query = randomVector(dimensions, 9999)

      // Calculate ground truth (brute force)
      const groundTruth = testVectors
        .map((vec, i) => ({
          id: testIds[i],
          score: cosineSimilarity(query, vec),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 100)

      // Create candidates that include ground truth with some noise
      // Simulate coarse search returning candidates with approximate scores
      const candidates: CoarseCandidate[] = testIds.map((id, i) => ({
        id,
        approximateScore: cosineSimilarity(query, testVectors[i]) + (Math.random() - 0.5) * 0.1,
        clusterId: Math.floor(i / 100),
      }))

      // Sort by approximate score and take top 500 (oversample)
      candidates.sort((a, b) => b.approximateScore - a.approximateScore)
      const topCandidates = candidates.slice(0, 500)

      // Create vectors map for reranking
      const vectorsMap = new Map<string, Float32Array>()
      for (const candidate of topCandidates) {
        const idx = testIds.indexOf(candidate.id)
        vectorsMap.set(candidate.id, testVectors[idx])
      }

      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates: topCandidates,
        clustersSearched: 10,
        candidatesScored: vectorCount,
      })
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors: vectorsMap,
        r2Calls: 5,
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions,
      })

      // Act
      const searchPromise = coordinator.search(query, 100, { oversample: 500 })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Calculate recall@100
      const groundTruthIds = new Set(groundTruth.map(r => r.id))
      const resultIds = result.results.map(r => r.id)
      const hits = resultIds.filter(id => groundTruthIds.has(id)).length
      const recall = hits / 100

      // Assert: 95%+ recall
      expect(recall).toBeGreaterThanOrEqual(0.95)
    })

    it('reports recall metric in response when ground truth provided', async () => {
      // Arrange
      const candidates = createTestCandidates(100)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)
      const query = randomVector(TEST_DIMENSIONS, 999)

      // Ground truth function
      const groundTruth = candidates
        .map(c => ({
          id: c.id,
          score: cosineSimilarity(query, vectors.get(c.id)!),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)

      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      // Act: Search with ground truth for recall computation
      const searchPromise = coordinator.search(query, 10, {
        computeRecall: true,
        groundTruth: groundTruth.map(r => r.id),
      })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Recall metric included
      expect(result.metrics.recall).toBeDefined()
      expect(result.metrics.recall).toBeGreaterThanOrEqual(0)
      expect(result.metrics.recall).toBeLessThanOrEqual(1)
    })

    it('maintains high recall even with conservative nprobe', async () => {
      // Arrange: Test recall with lower nprobe (fewer clusters)
      const candidates = createTestCandidates(50)
      const vectors = createTestVectorsMap(candidates, TEST_DIMENSIONS)
      const query = randomVector(TEST_DIMENSIONS, 999)

      // Ground truth
      const groundTruth = candidates
        .map(c => ({
          id: c.id,
          score: cosineSimilarity(query, vectors.get(c.id)!),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)

      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates,
        clustersSearched: 5, // Low nprobe
      })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      // Act
      const searchPromise = coordinator.search(query, 10, {
        nprobe: 5,
        computeRecall: true,
        groundTruth: groundTruth.map(r => r.id),
      })
      await vi.advanceTimersByTimeAsync(100)
      const result = await searchPromise

      // Assert: Still reasonable recall
      expect(result.metrics.recall).toBeGreaterThanOrEqual(0.8)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles empty query gracefully', async () => {
      // Arrange
      mockCoarseSearch = createMockCoarseSearchProvider({ candidates: [] })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors: new Map() })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      // Act & Assert
      const searchPromise = coordinator.search(new Float32Array(0), 10)
      await vi.advanceTimersByTimeAsync(50)

      await expect(searchPromise).rejects.toThrow(/invalid.*query|empty.*vector/i)
    })

    it('handles zero results from coarse search', async () => {
      // Arrange: Coarse search returns no candidates
      mockCoarseSearch = createMockCoarseSearchProvider({ candidates: [] })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors: new Map() })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert
      expect(result.results).toHaveLength(0)
      expect(result.metrics.candidatesScored).toBe(0)
    })

    it('handles coarse search failure gracefully', async () => {
      // Arrange: Coarse search fails
      mockCoarseSearch = createMockCoarseSearchProvider({
        candidates: [],
        shouldFail: true,
        failureError: new Error('Coarse search unavailable'),
      })
      mockRerankFetcher = createMockRerankFetcherProvider({ vectors: new Map() })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Graceful failure
      expect(result.error).toBeDefined()
      expect(result.error).toContain('Coarse search')
      expect(result.results).toHaveLength(0)
    })

    it('handles rerank fetcher failure gracefully', async () => {
      // Arrange: Rerank fails
      const candidates = createTestCandidates(20)
      mockCoarseSearch = createMockCoarseSearchProvider({ candidates })
      mockRerankFetcher = createMockRerankFetcherProvider({
        vectors: new Map(),
        shouldFail: true,
        failureError: new Error('R2 unavailable'),
      })

      coordinator = new StaticAssetsSearchCoordinator({
        coarseSearch: mockCoarseSearch,
        rerankFetcher: mockRerankFetcher,
        dimensions: TEST_DIMENSIONS,
        fallbackToApproximate: true,
      })

      const query = randomVector(TEST_DIMENSIONS, 999)

      // Act
      const searchPromise = coordinator.search(query, 10)
      await vi.advanceTimersByTimeAsync(50)
      const result = await searchPromise

      // Assert: Falls back to approximate results
      expect(result.results.length).toBeGreaterThan(0)
      expect(result.approximate).toBe(true)
      expect(result.error).toContain('R2 unavailable')
    })

    it('handles configuration with missing providers', () => {
      // Act & Assert: Missing coarse search
      expect(() => {
        new StaticAssetsSearchCoordinator({
          coarseSearch: undefined as any,
          rerankFetcher: createMockRerankFetcherProvider({ vectors: new Map() }),
          dimensions: TEST_DIMENSIONS,
        })
      }).toThrow(/coarseSearch.*required/i)

      // Act & Assert: Missing rerank fetcher
      expect(() => {
        new StaticAssetsSearchCoordinator({
          coarseSearch: createMockCoarseSearchProvider({ candidates: [] }),
          rerankFetcher: undefined as any,
          dimensions: TEST_DIMENSIONS,
        })
      }).toThrow(/rerankFetcher.*required/i)
    })
  })
})
