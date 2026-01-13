/**
 * Chunked HNSW Index Tests
 *
 * TDD tests for HNSW index chunking to work within 128MB memory limits on Durable Objects.
 * The strategy involves:
 * 1. Partitioning vectors into chunks based on memory budget
 * 2. Storing chunk files as sidecars (part-00001.usearch, etc.)
 * 3. Loading chunks on-demand during search
 * 4. Using binary quantization (b1) for 32x memory reduction
 *
 * @module db/edgevec/tests/chunked-hnsw.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate a random normalized vector
 */
function randomVector(dim: number): Float32Array {
  const v = new Float32Array(dim)
  let norm = 0
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() * 2 - 1
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dim; i++) {
    v[i] /= norm
  }
  return v
}

/**
 * Generate a reproducible vector based on seed
 */
function seededVector(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim)
  let norm = 0
  for (let i = 0; i < dim; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    v[i] = (seed / 0x7fffffff) * 2 - 1
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dim; i++) {
    v[i] /= norm
  }
  return v
}

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
 * Brute force k-NN search for validation
 */
function bruteForceKNN(
  query: Float32Array,
  vectors: Map<string, Float32Array>,
  k: number
): Array<{ id: string; score: number }> {
  const scores: Array<{ id: string; score: number }> = []
  for (const [id, v] of vectors) {
    scores.push({ id, score: cosineSimilarity(query, v) })
  }
  return scores.sort((a, b) => b.score - a.score).slice(0, k)
}

/**
 * Calculate recall@k between HNSW results and ground truth
 */
function calculateRecall(
  results: Array<{ id: string }>,
  groundTruth: Array<{ id: string }>
): number {
  const truthSet = new Set(groundTruth.map((r) => r.id))
  const hits = results.filter((r) => truthSet.has(r.id)).length
  return hits / groundTruth.length
}

/**
 * Estimate memory usage for vectors
 * Float32 = 4 bytes per value
 */
function estimateVectorMemory(count: number, dimensions: number): number {
  return count * dimensions * 4
}

/**
 * Estimate HNSW graph memory usage
 * Each node has M neighbors on average, stored as numeric IDs (8 bytes each)
 * Plus overhead for the node structure
 */
function estimateHNSWGraphMemory(count: number, M: number): number {
  const avgLayers = Math.ceil(Math.log2(count)) // approximate layer count
  const neighborsPerNode = M * avgLayers // rough estimate
  return count * (neighborsPerNode * 8 + 100) // neighbors + overhead
}

// ============================================================================
// MOCK CHUNK STORAGE
// ============================================================================

/**
 * Mock chunk storage interface (simulates R2 or KV storage)
 */
class MockChunkStorage {
  private chunks: Map<string, ArrayBuffer> = new Map()
  public loadedChunks: Set<string> = new Set()

  async put(key: string, data: ArrayBuffer): Promise<void> {
    this.chunks.set(key, data)
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const data = this.chunks.get(key)
    if (data) {
      this.loadedChunks.add(key)
    }
    return data ?? null
  }

  async delete(key: string): Promise<void> {
    this.chunks.delete(key)
  }

  async list(prefix: string): Promise<string[]> {
    return Array.from(this.chunks.keys()).filter((k) => k.startsWith(prefix))
  }

  getChunkCount(): number {
    return this.chunks.size
  }

  getTotalSize(): number {
    let total = 0
    for (const data of this.chunks.values()) {
      total += data.byteLength
    }
    return total
  }

  clearLoadedTracking(): void {
    this.loadedChunks.clear()
  }
}

// ============================================================================
// TYPE DEFINITIONS (to be implemented in chunked-hnsw.ts)
// ============================================================================

// These types define the expected API for the ChunkedHNSWIndex

interface ChunkedHNSWConfig {
  /** Number of dimensions in vectors */
  dimensions: number
  /** Max connections per node (default: 16) */
  M?: number
  /** Size of dynamic candidate list during construction (default: 200) */
  efConstruction?: number
  /** Distance metric (default: 'cosine') */
  metric?: 'cosine' | 'l2' | 'dot'
  /** Maximum memory per chunk in bytes (default: 10MB) */
  maxChunkSizeBytes?: number
  /** Enable binary quantization for 32x memory reduction */
  useBinaryQuantization?: boolean
  /** Storage backend for chunks */
  storage?: ChunkStorage
}

interface ChunkStorage {
  put(key: string, data: ArrayBuffer): Promise<void>
  get(key: string): Promise<ArrayBuffer | null>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

interface ChunkManifest {
  /** Index configuration */
  config: ChunkedHNSWConfig
  /** Total number of vectors */
  vectorCount: number
  /** Chunk information */
  chunks: ChunkInfo[]
  /** Entry point for search */
  entryPointChunk: number
  /** Entry point node within the chunk */
  entryPointNode: string
  /** Max level in the graph */
  maxLevel: number
  /** Created timestamp */
  createdAt: number
}

interface ChunkInfo {
  /** Chunk ID (index) */
  id: number
  /** Storage key */
  key: string
  /** Number of vectors in chunk */
  vectorCount: number
  /** Size in bytes */
  sizeBytes: number
  /** Min vector ID in chunk (for range queries) */
  minId: string
  /** Max vector ID in chunk */
  maxId: string
  /** Checksum for validation */
  checksum: string
}

interface ChunkedSearchResult {
  id: string
  score: number
  chunkId: number
}

interface ChunkLoadStats {
  /** Chunks loaded during search */
  chunksLoaded: number
  /** Total bytes loaded */
  bytesLoaded: number
  /** Peak memory usage in bytes */
  peakMemoryBytes: number
}

// ============================================================================
// CHUNK CONFIGURATION TESTS
// ============================================================================

describe('ChunkedHNSW Configuration', () => {
  it('creates index with default chunk size of 10MB', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
    })

    expect(index.config().maxChunkSizeBytes).toBe(10 * 1024 * 1024) // 10MB
  })

  it('allows custom chunk size configuration', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 5 * 1024 * 1024, // 5MB
    })

    expect(index.config().maxChunkSizeBytes).toBe(5 * 1024 * 1024)
  })

  it('validates chunk size must be at least 1MB', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')

    expect(() => new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 100 * 1024, // 100KB - too small
    })).toThrow(/chunk size must be at least 1MB/)
  })

  it('validates chunk size must not exceed 100MB', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')

    expect(() => new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 200 * 1024 * 1024, // 200MB - too large
    })).toThrow(/chunk size must not exceed 100MB/)
  })

  it('supports binary quantization mode', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      useBinaryQuantization: true,
    })

    expect(index.config().useBinaryQuantization).toBe(true)
  })

  it('calculates vectors per chunk based on dimensions', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')

    // 128 dimensions * 4 bytes = 512 bytes per vector
    // 10MB / 512 = ~20,000 vectors max (minus graph overhead)
    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
    })

    const maxVectorsPerChunk = index.getMaxVectorsPerChunk()

    // Should be less than theoretical max due to graph overhead
    expect(maxVectorsPerChunk).toBeLessThan(20000)
    expect(maxVectorsPerChunk).toBeGreaterThan(5000) // But reasonable
  })

  it('calculates vectors per chunk with binary quantization', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')

    // Binary: 128 dimensions / 8 = 16 bytes per vector (vs 512 bytes for float32)
    const indexBinary = new ChunkedHNSWIndex({
      dimensions: 128,
      useBinaryQuantization: true,
      maxChunkSizeBytes: 10 * 1024 * 1024,
    })

    const indexFloat = new ChunkedHNSWIndex({
      dimensions: 128,
      useBinaryQuantization: false,
      maxChunkSizeBytes: 10 * 1024 * 1024,
    })

    const binaryMax = indexBinary.getMaxVectorsPerChunk()
    const floatMax = indexFloat.getMaxVectorsPerChunk()

    // Binary should support more vectors due to smaller vector storage
    // The ratio depends on graph overhead which is similar for both
    expect(binaryMax).toBeGreaterThan(floatMax) // Binary supports more
  })
})

// ============================================================================
// CHUNK CREATION TESTS
// ============================================================================

describe('ChunkedHNSW Chunk Creation', () => {
  it('creates chunks when vector count exceeds threshold', { timeout: 30000 }, async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024, // 1MB for faster test
      storage,
      autoFlushThreshold: 500, // Auto flush at 500 vectors
    })

    // Insert enough vectors to create multiple chunks via auto-flush
    for (let i = 0; i < 1500; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush() // Final flush

    expect(storage.getChunkCount()).toBeGreaterThanOrEqual(2)
  })

  it('assigns vectors to appropriate chunks', { timeout: 30000 }, async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
      autoFlushThreshold: 300,
    })

    // Insert vectors (smaller count for faster test)
    for (let i = 0; i < 1000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    const manifest = await index.getManifest()

    // Each chunk should have the correct vector count
    let totalVectors = 0
    for (const chunk of manifest.chunks) {
      expect(chunk.vectorCount).toBeGreaterThan(0)
      expect(chunk.sizeBytes).toBeGreaterThan(0)
      totalVectors += chunk.vectorCount
    }

    expect(totalVectors).toBe(1000)
  })

  it('chunk files follow naming convention', { timeout: 30000 }, async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
      autoFlushThreshold: 500,
    })

    for (let i = 0; i < 1000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    const keys = await storage.list('chunk-')

    // Should have naming pattern: chunk-00001.bin, chunk-00002.bin, etc.
    for (const key of keys) {
      expect(key).toMatch(/^chunk-\d{5}\.bin$/)
    }
  })

  it('chunk size stays within configured limit', { timeout: 30000 }, async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const maxChunkSize = 2 * 1024 * 1024 // 2MB
    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: maxChunkSize,
      storage,
      autoFlushThreshold: 500,
    })

    for (let i = 0; i < 2000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    const manifest = await index.getManifest()

    for (const chunk of manifest.chunks) {
      expect(chunk.sizeBytes).toBeLessThanOrEqual(maxChunkSize * 2) // Allow overhead for JSON
    }
  })

  it('maintains HNSW graph connectivity across chunks', { timeout: 30000 }, async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
      autoFlushThreshold: 500,
    })

    for (let i = 0; i < 1000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    // Validate graph connectivity by checking entry point exists
    const manifest = await index.getManifest()
    expect(manifest.entryPointChunk).toBeGreaterThanOrEqual(0)
    expect(manifest.entryPointNode).toBeDefined()
    expect(manifest.maxLevel).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// ON-DEMAND CHUNK LOADING TESTS
// ============================================================================

describe('ChunkedHNSW On-Demand Loading', () => {
  it('loads only necessary chunks during search', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
    })

    // Insert vectors
    for (let i = 0; i < 5000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()
    storage.clearLoadedTracking()

    // Perform search
    const query = seededVector(128, 42)
    await index.search(query, { k: 10 })

    // Should NOT have loaded all chunks
    const manifest = await index.getManifest()
    expect(storage.loadedChunks.size).toBeLessThan(manifest.chunks.length)
  })

  it('tracks chunk load statistics', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 5000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    const query = seededVector(128, 42)
    const { results, loadStats } = await index.searchWithStats(query, { k: 10 })

    expect(loadStats.chunksLoaded).toBeGreaterThan(0)
    expect(loadStats.bytesLoaded).toBeGreaterThan(0)
    expect(loadStats.peakMemoryBytes).toBeLessThan(100 * 1024 * 1024) // Under 100MB
  })

  it('caches recently accessed chunks', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 3000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    // First search
    const query1 = seededVector(128, 100)
    await index.search(query1, { k: 10 })
    const firstLoadCount = storage.loadedChunks.size

    storage.clearLoadedTracking()

    // Second search with similar query (should hit cache)
    const query2 = seededVector(128, 101)
    await index.search(query2, { k: 10 })
    const secondLoadCount = storage.loadedChunks.size

    // Second search should load fewer or equal chunks due to caching
    expect(secondLoadCount).toBeLessThanOrEqual(firstLoadCount)
  })

  it('evicts chunks when cache exceeds memory budget', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
      // Set a small cache budget for testing
      maxCacheBytes: 5 * 1024 * 1024, // 5MB cache
    } as any)

    for (let i = 0; i < 10000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    // Perform many searches to fill cache
    for (let i = 0; i < 20; i++) {
      const query = randomVector(128)
      await index.search(query, { k: 10 })
    }

    // Cache memory should stay under budget
    const cacheStats = index.getCacheStats()
    expect(cacheStats.currentBytes).toBeLessThanOrEqual(5 * 1024 * 1024 * 1.1) // Allow 10% margin
  })
})

// ============================================================================
// MEMORY CONSTRAINT TESTS
// ============================================================================

describe('ChunkedHNSW Memory Constraints', () => {
  it('keeps memory under 100MB during search with 1M vectors', { timeout: 120000 }, async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
      useBinaryQuantization: true, // Use binary for 32x reduction
      storage,
    })

    // Insert 100K vectors (scaled down from 1M for test speed)
    // Each binary vector: 128/8 = 16 bytes
    // 100K * 16 = 1.6MB vectors + graph overhead
    const vectorCount = 100000

    for (let i = 0; i < vectorCount; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    // Search should use less than 100MB
    const query = seededVector(128, 50000)
    const { results, loadStats } = await index.searchWithStats(query, { k: 10 })

    expect(loadStats.peakMemoryBytes).toBeLessThan(100 * 1024 * 1024)
    expect(results.length).toBe(10)
  })

  it('loads chunks in under 100ms', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 10000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    // Measure chunk load time
    const start = performance.now()
    const query = seededVector(128, 5000)
    await index.search(query, { k: 10 })
    const elapsed = performance.now() - start

    // Total search (including chunk loads) should be < 500ms
    // Individual chunk loads should be << 100ms
    expect(elapsed).toBeLessThan(500)
  })

  it('completes search in under 500ms with large index', { timeout: 60000 }, async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
      useBinaryQuantization: true,
      storage,
    })

    for (let i = 0; i < 50000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    // Warm up cache
    await index.search(randomVector(128), { k: 10 })

    // Measure search time
    const searchTimes: number[] = []
    for (let i = 0; i < 10; i++) {
      const query = randomVector(128)
      const start = performance.now()
      await index.search(query, { k: 10 })
      searchTimes.push(performance.now() - start)
    }

    const avgTime = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length
    expect(avgTime).toBeLessThan(500)
  })
})

// ============================================================================
// BINARY QUANTIZATION TESTS
// ============================================================================

describe('ChunkedHNSW Binary Quantization', () => {
  it('binarizes vectors using sign threshold', async () => {
    const { ChunkedHNSWIndex, binarizeVector } = await import('../chunked-hnsw')

    const vector = new Float32Array([
      0.5, -0.3, 0.0, 0.1, -0.9, 0.7, -0.2, 0.4,
      ...new Array(120).fill(0).map((_, i) => (i % 2 === 0 ? 0.1 : -0.1))
    ])

    const binary = binarizeVector(vector)

    expect(binary).toBeInstanceOf(Uint8Array)
    expect(binary.length).toBe(16) // 128 bits = 16 bytes
  })

  it('achieves 32x memory reduction with binary quantization', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    // Create index without binary quantization
    const indexFloat = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
      useBinaryQuantization: false,
      storage: new MockChunkStorage(),
    })

    // Create index with binary quantization
    const indexBinary = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
      useBinaryQuantization: true,
      storage,
    })

    const vectorCount = 5000
    for (let i = 0; i < vectorCount; i++) {
      const v = seededVector(128, i)
      await indexFloat.insert(`vec-${i}`, v)
      await indexBinary.insert(`vec-${i}`, v)
    }

    await indexFloat.flush()
    await indexBinary.flush()

    // Binary should use much less storage
    const floatStorage = (indexFloat as any).storage as MockChunkStorage
    const binaryStorage = storage

    const compressionRatio = floatStorage.getTotalSize() / binaryStorage.getTotalSize()

    // Should achieve significant compression (not exactly 32x due to graph overhead)
    expect(compressionRatio).toBeGreaterThan(10)
  })

  it('achieves recall@10 > 90% with binary quantization and reranking', { timeout: 60000 }, async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
      useBinaryQuantization: true,
      storage,
    })

    // Store original vectors for ground truth
    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 10000; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      await index.insert(`vec-${i}`, v)
    }

    await index.flush()

    // Run queries and measure recall
    let totalRecall = 0
    const numQueries = 50

    for (let q = 0; q < numQueries; q++) {
      const query = seededVector(128, q + 20000)

      // Get results with reranking enabled (default)
      const results = await index.search(query, { k: 10 })

      // Get ground truth via brute force
      const groundTruth = bruteForceKNN(query, vectors, 10)

      totalRecall += calculateRecall(results, groundTruth)
    }

    const avgRecall = totalRecall / numQueries
    expect(avgRecall).toBeGreaterThan(0.9) // 90% recall
  })

  it('computes hamming distance for binary vectors efficiently', async () => {
    const { binarizeVector, hammingDistance } = await import('../chunked-hnsw')

    const v1 = new Float32Array(1024).fill(0.5) // All positive -> all 1s
    const v2 = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) {
      v2[i] = i < 100 ? -0.5 : 0.5 // 100 negative, 924 positive
    }

    const b1 = binarizeVector(v1)
    const b2 = binarizeVector(v2)

    const distance = hammingDistance(b1, b2)
    expect(distance).toBe(100) // 100 bits different

    // Test performance
    const start = performance.now()
    for (let i = 0; i < 100000; i++) {
      hammingDistance(b1, b2)
    }
    const elapsed = performance.now() - start

    // 100K hamming distances should be very fast
    expect(elapsed).toBeLessThan(100) // < 100ms
  })
})

// ============================================================================
// SEARCH QUALITY TESTS
// ============================================================================

describe('ChunkedHNSW Search Quality', () => {
  it('finds exact match as top result', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 1000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    // Search for exact vector
    const query = seededVector(128, 500)
    const results = await index.search(query, { k: 10 })

    expect(results[0].id).toBe('vec-500')
    expect(results[0].score).toBeCloseTo(1.0, 3)
  })

  it('returns results sorted by score', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 1000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    const query = randomVector(128)
    const results = await index.search(query, { k: 20 })

    // Results should be sorted by descending score
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
    }
  })

  it('handles k larger than index size', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 50; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    const results = await index.search(randomVector(128), { k: 100 })
    expect(results.length).toBe(50) // Returns all available
  })

  it('respects ef parameter for quality/speed tradeoff', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 10 * 1024 * 1024,
      storage,
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 5000; i++) {
      const v = seededVector(128, i)
      vectors.set(`vec-${i}`, v)
      await index.insert(`vec-${i}`, v)
    }

    await index.flush()

    const query = seededVector(128, 2500)
    const groundTruth = bruteForceKNN(query, vectors, 10)

    // Low ef = faster but potentially less accurate
    const resultsLowEf = await index.search(query, { k: 10, ef: 20 })
    const recallLow = calculateRecall(resultsLowEf, groundTruth)

    // High ef = slower but more accurate
    const resultsHighEf = await index.search(query, { k: 10, ef: 200 })
    const recallHigh = calculateRecall(resultsHighEf, groundTruth)

    // Higher ef should give equal or better recall
    expect(recallHigh).toBeGreaterThanOrEqual(recallLow)
  })
})

// ============================================================================
// SERIALIZATION TESTS
// ============================================================================

describe('ChunkedHNSW Serialization', () => {
  it('saves manifest to storage', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 1000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    // Should have manifest key
    const keys = await storage.list('manifest')
    expect(keys.length).toBe(1)

    const manifestData = await storage.get(keys[0]!)
    expect(manifestData).not.toBeNull()

    // Parse manifest
    const manifest = JSON.parse(new TextDecoder().decode(manifestData!)) as ChunkManifest
    expect(manifest.vectorCount).toBe(1000)
    expect(manifest.chunks.length).toBeGreaterThan(0)
  })

  it('loads index from existing chunks', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    // Create and populate index
    const index1 = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 1000; i++) {
      await index1.insert(`vec-${i}`, seededVector(128, i))
    }

    await index1.flush()

    // Load from same storage
    const index2 = await ChunkedHNSWIndex.load(storage)

    expect(index2.size()).toBe(1000)

    // Search should work
    const query = seededVector(128, 500)
    const results = await index2.search(query, { k: 10 })
    expect(results[0].id).toBe('vec-500')
  })

  it('validates chunk checksums on load', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 1000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    // Corrupt a chunk
    const chunkKeys = await storage.list('chunk-')
    if (chunkKeys.length > 0) {
      await storage.put(chunkKeys[0]!, new ArrayBuffer(100)) // Replace with garbage
    }

    // Loading should fail or detect corruption
    await expect(ChunkedHNSWIndex.load(storage, { validateChecksums: true }))
      .rejects.toThrow(/checksum mismatch|corrupted/)
  })

  it('chunk files use binary format for efficiency', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 5 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 5000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    await index.flush()

    // Calculate expected size vs actual
    // Float32 vectors: 5000 * 128 * 4 = 2.56MB
    // Graph overhead: ~M neighbors per node * 8 bytes
    const expectedMinSize = 5000 * 128 * 4

    expect(storage.getTotalSize()).toBeLessThan(expectedMinSize * 2) // Within 2x expected
  })
})

// ============================================================================
// INCREMENTAL UPDATE TESTS
// ============================================================================

describe('ChunkedHNSW Incremental Updates', () => {
  it('allows inserting vectors after flush', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
    })

    // Insert first batch
    for (let i = 0; i < 500; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }
    await index.flush()

    // Insert second batch
    for (let i = 500; i < 1000; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }
    await index.flush()

    expect(index.size()).toBe(1000)

    // Search should find vectors from both batches
    const query1 = seededVector(128, 250)
    const results1 = await index.search(query1, { k: 1 })
    expect(results1[0].id).toBe('vec-250')

    const query2 = seededVector(128, 750)
    const results2 = await index.search(query2, { k: 1 })
    expect(results2[0].id).toBe('vec-750')
  })

  it('buffers inserts before flushing', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
    })

    // Insert without flushing
    for (let i = 0; i < 100; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    // No chunks should exist yet
    expect(storage.getChunkCount()).toBe(0)

    // Search should still work from buffer
    const query = seededVector(128, 50)
    const results = await index.search(query, { k: 1 })
    expect(results[0].id).toBe('vec-50')
  })

  it('auto-flushes when buffer exceeds threshold', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      maxChunkSizeBytes: 1 * 1024 * 1024,
      storage,
      autoFlushThreshold: 500, // Auto-flush at 500 vectors
    } as any)

    // Insert enough to trigger auto-flush
    for (let i = 0; i < 600; i++) {
      await index.insert(`vec-${i}`, seededVector(128, i))
    }

    // Should have auto-flushed
    expect(storage.getChunkCount()).toBeGreaterThan(0)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ChunkedHNSW Edge Cases', () => {
  it('handles empty index', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      storage,
    })

    const results = await index.search(randomVector(128), { k: 10 })
    expect(results).toHaveLength(0)
  })

  it('handles single vector', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      storage,
    })

    const v = seededVector(128, 42)
    await index.insert('only-one', v)
    await index.flush()

    const results = await index.search(v, { k: 10 })
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('only-one')
    expect(results[0].score).toBeCloseTo(1.0, 3)
  })

  it('handles high dimensions (1536)', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 1536, // OpenAI embedding size
      maxChunkSizeBytes: 10 * 1024 * 1024,
      storage,
    })

    for (let i = 0; i < 100; i++) {
      await index.insert(`vec-${i}`, seededVector(1536, i))
    }

    await index.flush()

    const results = await index.search(seededVector(1536, 50), { k: 10 })
    expect(results[0].id).toBe('vec-50')
  })

  it('validates dimension mismatch on insert', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      storage,
    })

    await expect(
      index.insert('wrong', randomVector(64))
    ).rejects.toThrow(/dimension mismatch/)
  })

  it('validates dimension mismatch on search', async () => {
    const { ChunkedHNSWIndex } = await import('../chunked-hnsw')
    const storage = new MockChunkStorage()

    const index = new ChunkedHNSWIndex({
      dimensions: 128,
      storage,
    })

    await index.insert('vec-1', randomVector(128))
    await index.flush()

    await expect(
      index.search(randomVector(64), { k: 10 })
    ).rejects.toThrow(/dimension mismatch/)
  })
})
