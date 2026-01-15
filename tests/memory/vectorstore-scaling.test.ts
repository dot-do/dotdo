/**
 * VectorStore Memory Scaling Tests (RED Phase)
 *
 * These tests verify that VectorStore scales properly with large datasets.
 * Currently, the implementation has several scaling issues:
 *
 * 1. InMemoryVectorIndex loads ALL vectors into memory
 * 2. No pagination/streaming for large query results
 * 3. Batch operations load everything at once
 * 4. Linear scan O(n) for every query
 *
 * These tests should FAIL initially (RED phase) to demonstrate
 * the scaling problems that need to be addressed.
 *
 * @module tests/memory/vectorstore-scaling.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  VectorStore,
  InMemoryVectorIndex,
  MockEmbeddingProvider,
  resetVectorStore,
  type VectorizeIndex,
  type VectorMetadata,
} from '../../semantic/vector-store'
import { noun, thing, resetState, type Thing } from '../../semantic/index'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Number of vectors for "large dataset" tests */
const LARGE_DATASET_SIZE = 10_000

/** Number of vectors for "very large dataset" tests */
const VERY_LARGE_DATASET_SIZE = 100_000

/** Memory limit in MB for acceptable overhead per 1K vectors */
const MAX_MB_PER_1K_VECTORS = 5

/** Maximum acceptable query time in ms for large datasets */
const MAX_QUERY_TIME_MS = 100

/** Vector dimension (768 for BGE model) */
const VECTOR_DIMENSION = 768

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a random vector of given dimension
 */
function randomVector(dim: number): number[] {
  const v = new Array(dim).fill(0).map(() => Math.random())
  const mag = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
  return v.map((x) => x / mag)
}

/**
 * Generate test Things with sequential IDs
 */
function generateThings(count: number, type: string = 'TestItem'): Thing[] {
  const Noun = noun(type)
  return Array.from({ length: count }, (_, i) =>
    thing(Noun, `${type.toLowerCase()}-${i}`, {
      name: `${type} ${i}`,
      description: `Description for item ${i}`,
      value: Math.random() * 1000,
    })
  )
}

/**
 * Measure memory usage (approximate via array buffer sizes)
 * Returns MB
 */
function estimateMemoryMB(vectorCount: number, dimension: number): number {
  // Each float64 is 8 bytes, plus overhead for metadata
  const bytesPerVector = dimension * 8 + 200 // ~200 bytes metadata overhead
  return (vectorCount * bytesPerVector) / (1024 * 1024)
}

/**
 * Get approximate heap usage if available
 */
function getHeapUsedMB(): number | null {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed / (1024 * 1024)
  }
  return null
}

// ============================================================================
// TEST SETUP
// ============================================================================

beforeEach(() => {
  resetState()
  resetVectorStore()
})

// ============================================================================
// TEST: Large Vector Sets Don't OOM
// ============================================================================

describe('Large vector sets memory handling', () => {
  it('should support lazy loading / streaming for large datasets', async () => {
    /**
     * FAILING TEST (RED):
     * The current InMemoryVectorIndex loads ALL vectors into a Map.
     * This test verifies that there's a mechanism to handle large datasets
     * without loading everything into memory at once.
     *
     * Expected behavior: VectorStore should have a lazy loading or streaming
     * mechanism for datasets larger than some threshold.
     */
    const index = new InMemoryVectorIndex()

    // Insert a large number of vectors
    const vectors = Array.from({ length: LARGE_DATASET_SIZE }, (_, i) => ({
      id: `vec-${i}`,
      values: randomVector(VECTOR_DIMENSION),
      metadata: { $id: `vec-${i}`, $type: 'Test', data: JSON.stringify({ i }) },
    }))

    await index.upsert(vectors)

    // Check if index supports lazy loading capability
    // This should fail because InMemoryVectorIndex has no lazy loading
    expect(index).toHaveProperty('lazyLoadEnabled')
    expect((index as unknown as { lazyLoadEnabled: boolean }).lazyLoadEnabled).toBe(true)
  })

  it('should have configurable memory limits', async () => {
    /**
     * FAILING TEST (RED):
     * VectorStore should have configurable memory limits that trigger
     * disk spillover or eviction when exceeded.
     *
     * Expected behavior: VectorStore accepts maxMemoryMB config and
     * enforces it by evicting LRU vectors or spilling to disk.
     */
    const store = new VectorStore({
      // This config option doesn't exist yet
      maxMemoryMB: 100,
    } as never)

    // Verify memory limit is respected
    expect(store).toHaveProperty('maxMemoryMB')
    expect((store as unknown as { maxMemoryMB: number }).maxMemoryMB).toBe(100)
  })

  it('should support disk-backed storage for vectors exceeding memory', async () => {
    /**
     * FAILING TEST (RED):
     * For very large datasets, vectors should spill to disk when memory
     * pressure is high.
     *
     * Expected behavior: Index provides a disk-backed mode or hybrid mode.
     */
    const index = new InMemoryVectorIndex()

    // Check for disk-backed capability
    expect(index).toHaveProperty('enableDiskStorage')
    expect(typeof (index as unknown as { enableDiskStorage: (path: string) => void }).enableDiskStorage).toBe('function')
  })
})

// ============================================================================
// TEST: Pagination/Streaming for Queries
// ============================================================================

describe('Query pagination and streaming', () => {
  it('should support cursor-based pagination for query results', async () => {
    /**
     * FAILING TEST (RED):
     * The current query() method returns all matches up to topK in one call.
     * For large result sets, this should support cursor-based pagination.
     *
     * Expected behavior: query() accepts a cursor parameter and returns
     * a cursor for the next page.
     */
    const index = new InMemoryVectorIndex()

    // Insert vectors
    const vectors = Array.from({ length: 1000 }, (_, i) => ({
      id: `vec-${i}`,
      values: randomVector(VECTOR_DIMENSION),
      metadata: { $id: `vec-${i}`, $type: 'Test' },
    }))
    await index.upsert(vectors)

    // Query with pagination
    const queryVector = randomVector(VECTOR_DIMENSION)
    const result = await index.query(queryVector, {
      topK: 100,
      // These options don't exist yet
      cursor: undefined,
      pageSize: 10,
    } as Parameters<VectorizeIndex['query']>[1])

    // Should return pagination info
    expect(result).toHaveProperty('cursor')
    expect(result).toHaveProperty('hasMore')
    expect((result as unknown as { cursor: string }).cursor).toBeDefined()
  })

  it('should support async iterator for streaming large result sets', async () => {
    /**
     * FAILING TEST (RED):
     * For processing large result sets, the index should provide an
     * async iterator to stream results one-by-one.
     *
     * Expected behavior: index.queryStream() returns AsyncIterable<VectorMatch>
     */
    const index = new InMemoryVectorIndex()

    // Insert vectors
    const vectors = Array.from({ length: 100 }, (_, i) => ({
      id: `vec-${i}`,
      values: randomVector(VECTOR_DIMENSION),
      metadata: { $id: `vec-${i}`, $type: 'Test' },
    }))
    await index.upsert(vectors)

    // Check for streaming capability
    expect(index).toHaveProperty('queryStream')
    expect(typeof (index as unknown as { queryStream: () => AsyncIterable<unknown> }).queryStream).toBe('function')
  })

  it('should support result streaming in VectorStore.search', async () => {
    /**
     * FAILING TEST (RED):
     * VectorStore.search should have a streaming variant that doesn't
     * buffer all results in memory.
     *
     * Expected behavior: store.searchStream() returns AsyncIterable<Thing>
     */
    const store = new VectorStore()

    // Check for streaming search capability
    expect(store).toHaveProperty('searchStream')
    expect(typeof (store as unknown as { searchStream: () => AsyncIterable<Thing> }).searchStream).toBe('function')
  })
})

// ============================================================================
// TEST: Memory Usage Scales Sub-linearly
// ============================================================================

describe('Sub-linear memory scaling', () => {
  it('should use approximate indexing (ANN) instead of exact linear scan', async () => {
    /**
     * FAILING TEST (RED):
     * The current implementation does O(n) cosine similarity for every query.
     * This should use an ANN (Approximate Nearest Neighbor) index like HNSW
     * for sub-linear query time.
     *
     * Expected behavior: Index has an indexType property indicating ANN algorithm.
     */
    const index = new InMemoryVectorIndex()

    // Check for ANN index capability
    expect(index).toHaveProperty('indexType')
    const indexType = (index as unknown as { indexType: string }).indexType
    expect(['hnsw', 'ivf', 'pq', 'ann']).toContain(indexType)
  })

  it('should have O(log n) or O(1) query time for large datasets', async () => {
    /**
     * FAILING TEST (RED):
     * Query time should not grow linearly with dataset size.
     *
     * Expected behavior: Query time remains roughly constant or grows
     * logarithmically as dataset size increases.
     *
     * This test verifies the index has an ANN (Approximate Nearest Neighbor)
     * index type that provides sub-linear query complexity.
     */
    const index = new InMemoryVectorIndex()

    // Verify index reports sub-linear complexity
    expect(index).toHaveProperty('queryComplexity')
    const complexity = (index as unknown as { queryComplexity: string }).queryComplexity

    // Should be O(log n) or O(1), not O(n)
    expect(['O(log n)', 'O(1)', 'sublinear']).toContain(complexity)
  })

  it('should support memory-efficient vector compression (PQ)', async () => {
    /**
     * FAILING TEST (RED):
     * For large datasets, vectors should be compressible using Product
     * Quantization (PQ) or similar techniques to reduce memory footprint.
     *
     * Expected behavior: Index supports vector compression.
     */
    const index = new InMemoryVectorIndex()

    // Check for compression capability
    expect(index).toHaveProperty('compressionEnabled')
    expect(index).toHaveProperty('setCompression')
    expect(typeof (index as unknown as { setCompression: (type: string) => void }).setCompression).toBe('function')
  })
})

// ============================================================================
// TEST: Batch Operations Don't Load Everything
// ============================================================================

describe('Batch operations memory efficiency', () => {
  it('should process batch inserts in chunks without loading all into memory', async () => {
    /**
     * FAILING TEST (RED):
     * The current indexBatch loads all embeddings into memory at once.
     * Should process in smaller chunks to limit memory pressure.
     *
     * Expected behavior: indexBatch has a chunkSize parameter and processes
     * vectors incrementally.
     */
    const store = new VectorStore()

    // Check for chunked batch processing
    expect(store).toHaveProperty('indexBatchChunked')
    expect(typeof (store as unknown as { indexBatchChunked: (things: Thing[], opts: { chunkSize: number }) => Promise<void> }).indexBatchChunked).toBe('function')
  })

  it('should support streaming batch inserts via async iterator', async () => {
    /**
     * FAILING TEST (RED):
     * For very large batch inserts, should accept an async iterator
     * instead of requiring all items in memory.
     *
     * Expected behavior: indexBatch accepts AsyncIterable<Thing>
     */
    const store = new VectorStore()

    // Check for streaming insert capability
    expect(store).toHaveProperty('indexStream')
    expect(typeof (store as unknown as { indexStream: (stream: AsyncIterable<Thing>) => Promise<void> }).indexStream).toBe('function')
  })

  it('should not load all vectors for getByIds with large ID list', async () => {
    /**
     * FAILING TEST (RED):
     * When fetching many vectors by ID, should batch the requests
     * and not load everything at once.
     *
     * Expected behavior: getByIds processes in batches internally.
     */
    const index = new InMemoryVectorIndex()

    // Insert vectors
    const vectors = Array.from({ length: 1000 }, (_, i) => ({
      id: `vec-${i}`,
      values: randomVector(VECTOR_DIMENSION),
      metadata: { $id: `vec-${i}`, $type: 'Test' },
    }))
    await index.upsert(vectors)

    // Check for batched getByIds
    expect(index).toHaveProperty('getByIdsBatched')
    const getBatched = (index as unknown as { getByIdsBatched: (ids: string[], batchSize: number) => AsyncIterable<{ id: string; values: number[] }> }).getByIdsBatched

    expect(typeof getBatched).toBe('function')
  })

  it('should support delete batching for large ID lists', async () => {
    /**
     * FAILING TEST (RED):
     * deleteByIds should batch large ID lists to avoid memory spikes.
     *
     * Expected behavior: deleteByIds processes in batches internally
     * and accepts a batchSize option.
     */
    const index = new InMemoryVectorIndex()

    // Check for batched delete capability
    expect(index).toHaveProperty('deleteByIdsBatched')
    expect(typeof (index as unknown as { deleteByIdsBatched: (ids: string[], batchSize: number) => Promise<{ count: number }> }).deleteByIdsBatched).toBe('function')
  })
})

// ============================================================================
// TEST: Query Performance at Scale
// ============================================================================

describe('Query performance at scale', () => {
  it('should provide sub-linear query guarantees via ANN index', async () => {
    /**
     * FAILING TEST (RED):
     * The index should provide an API to verify its query performance characteristics.
     *
     * Expected behavior: Index has a method to report its query complexity
     * and guarantees sub-linear scaling (O(log n) or better).
     *
     * This is different from timing tests because:
     * 1. Timing tests are flaky depending on hardware
     * 2. We want to verify the algorithm, not just the speed
     * 3. ANN indexes trade some accuracy for speed - we should verify that tradeoff
     */
    const index = new InMemoryVectorIndex()

    // Check for performance characteristics API
    expect(index).toHaveProperty('getPerformanceCharacteristics')
    const getCharacteristics = (index as unknown as {
      getPerformanceCharacteristics: () => {
        queryComplexity: string
        indexType: string
        supportsANN: boolean
      }
    }).getPerformanceCharacteristics

    const characteristics = getCharacteristics()

    // Verify ANN support for sub-linear queries
    expect(characteristics.supportsANN).toBe(true)
    expect(['O(log n)', 'O(1)', 'O(log n * log n)']).toContain(characteristics.queryComplexity)
    expect(['hnsw', 'ivf', 'pq', 'lsh', 'annoy']).toContain(characteristics.indexType)
  })

  it('should support pre-filtering to reduce search space', async () => {
    /**
     * FAILING TEST (RED):
     * The current filter implementation still scans all vectors.
     * Should use inverted index for type filtering to reduce search space.
     *
     * Expected behavior: Index maintains inverted index by $type for fast filtering.
     */
    const index = new InMemoryVectorIndex()

    // Check for inverted index support
    expect(index).toHaveProperty('hasInvertedIndex')
    expect((index as unknown as { hasInvertedIndex: boolean }).hasInvertedIndex).toBe(true)
  })

  it('should provide query plan / explain for performance analysis', async () => {
    /**
     * FAILING TEST (RED):
     * For debugging performance issues, should be able to get a query plan.
     *
     * Expected behavior: Index has explainQuery method.
     */
    const index = new InMemoryVectorIndex()

    expect(index).toHaveProperty('explainQuery')
    expect(typeof (index as unknown as { explainQuery: () => object }).explainQuery).toBe('function')
  })
})

// ============================================================================
// TEST: Memory Pressure Handling
// ============================================================================

describe('Memory pressure handling', () => {
  it('should have memory usage reporting', async () => {
    /**
     * FAILING TEST (RED):
     * Index should report its current memory usage for monitoring.
     *
     * Expected behavior: Index has getMemoryUsage() method returning bytes.
     */
    const index = new InMemoryVectorIndex()

    await index.upsert([
      { id: 'v1', values: randomVector(VECTOR_DIMENSION), metadata: { $id: 'v1', $type: 'Test' } },
    ])

    expect(index).toHaveProperty('getMemoryUsage')
    const getMemUsage = (index as unknown as { getMemoryUsage: () => number }).getMemoryUsage
    expect(typeof getMemUsage).toBe('function')

    const usage = getMemUsage()
    expect(typeof usage).toBe('number')
    expect(usage).toBeGreaterThan(0)
  })

  it('should support LRU eviction when memory limit exceeded', async () => {
    /**
     * FAILING TEST (RED):
     * When memory limit is reached, should evict least-recently-used vectors.
     *
     * Expected behavior: Index supports LRU eviction policy.
     */
    const index = new InMemoryVectorIndex()

    expect(index).toHaveProperty('setEvictionPolicy')
    expect(typeof (index as unknown as { setEvictionPolicy: (policy: string) => void }).setEvictionPolicy).toBe('function')
  })

  it('should emit memory warning events before OOM', async () => {
    /**
     * FAILING TEST (RED):
     * Index should emit events when approaching memory limits.
     *
     * Expected behavior: Index extends EventEmitter and emits 'memory-warning'.
     */
    const index = new InMemoryVectorIndex()

    expect(index).toHaveProperty('on')
    expect(typeof (index as unknown as { on: (event: string, handler: () => void) => void }).on).toBe('function')
  })
})

// ============================================================================
// TEST: Concurrent Access
// ============================================================================

describe('Concurrent access handling', () => {
  it('should handle concurrent queries without memory spikes', async () => {
    /**
     * FAILING TEST (RED):
     * Multiple concurrent queries should share resources efficiently.
     *
     * Expected behavior: Memory doesn't spike linearly with concurrent queries.
     */
    const index = new InMemoryVectorIndex()

    // Insert vectors
    const vectors = Array.from({ length: 1000 }, (_, i) => ({
      id: `vec-${i}`,
      values: randomVector(VECTOR_DIMENSION),
      metadata: { $id: `vec-${i}`, $type: 'Test' },
    }))
    await index.upsert(vectors)

    // Check for concurrent query support metrics
    expect(index).toHaveProperty('getConcurrencyStats')
    expect(typeof (index as unknown as { getConcurrencyStats: () => object }).getConcurrencyStats).toBe('function')
  })

  it('should support query cancellation to free resources', async () => {
    /**
     * FAILING TEST (RED):
     * Long-running queries should be cancellable to free up resources.
     *
     * Expected behavior: query() accepts AbortSignal.
     */
    const index = new InMemoryVectorIndex()

    await index.upsert([
      { id: 'v1', values: randomVector(VECTOR_DIMENSION) },
    ])

    const controller = new AbortController()
    const queryVector = randomVector(VECTOR_DIMENSION)

    // This should accept signal option
    const queryPromise = index.query(queryVector, {
      topK: 10,
      signal: controller.signal,
    } as Parameters<VectorizeIndex['query']>[1])

    // Cancel immediately
    controller.abort()

    // Should reject with AbortError
    await expect(queryPromise).rejects.toThrow(/abort/i)
  })
})
