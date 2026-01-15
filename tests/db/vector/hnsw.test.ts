/**
 * HNSW Vector Backend Tests (RED Phase)
 *
 * Comprehensive tests for HNSW (Hierarchical Navigable Small World) vector backend.
 * These tests define the expected behavior for:
 * - Graph construction with M and efConstruction parameters
 * - Approximate nearest neighbor search
 * - Dynamic insertion and deletion
 * - Persistence to SQLite (graph structure)
 * - Multi-level graph navigation
 * - Recall vs speed tradeoffs
 *
 * All tests should FAIL until implementation exists in db/vector/engines/hnsw.ts
 *
 * HNSW Overview:
 * - Multi-layer graph where higher layers contain "express routes"
 * - M: number of bidirectional connections per node per layer
 * - efConstruction: size of dynamic candidate list during construction
 * - efSearch: size of dynamic candidate list during search
 *
 * @see db/vector/README.md
 * @module tests/db/vector/hnsw.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

let HNSWIndex: any
let createHNSWIndex: any
let HNSWConfig: any

beforeEach(async () => {
  try {
    // Import from the expected engine location
    const hnswModule = await import('../../../db/vector/engines/hnsw')
    HNSWIndex = hnswModule.HNSWIndex
    createHNSWIndex = hnswModule.createHNSWIndex
    HNSWConfig = hnswModule.HNSWConfig
  } catch {
    HNSWIndex = undefined
    createHNSWIndex = undefined
    HNSWConfig = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `HNSW module not implemented. Expected '${fnName}' from 'db/vector/engines/hnsw'. ` +
        `Create the module to make this test pass.`
    )
  }
}

/**
 * Generate a random normalized vector (unit length for cosine similarity)
 */
function randomNormalizedVector(dims: number, seed?: number): Float32Array {
  const vec = new Float32Array(dims)
  let s = seed ?? Math.floor(Math.random() * 2147483647)

  let norm = 0
  for (let i = 0; i < dims; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u1 = s / 0x7fffffff
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u2 = s / 0x7fffffff
    // Box-Muller transform: ensure u1 is in (0, 1) to avoid log(0) and log(>1)
    const u1Clamped = Math.min(Math.max(u1, 0.0001), 0.9999)
    const z = Math.sqrt(-2 * Math.log(u1Clamped)) * Math.cos(2 * Math.PI * u2)
    vec[i] = z
    norm += z * z
  }

  norm = Math.sqrt(norm)
  for (let i = 0; i < dims; i++) {
    vec[i] /= norm
  }

  return vec
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const minLen = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < minLen; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Compute L2 distance between two vectors
 */
function l2Distance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Compute ground truth k-nearest neighbors using brute force
 */
function bruteForceKNN(
  query: Float32Array,
  vectors: Map<string, Float32Array>,
  k: number,
  metric: 'cosine' | 'l2' = 'cosine'
): Array<{ id: string; score: number }> {
  const results: Array<{ id: string; score: number }> = []

  for (const [id, vec] of vectors) {
    const score = metric === 'cosine' ? cosineSimilarity(query, vec) : -l2Distance(query, vec)
    results.push({ id, score })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, k)
}

/**
 * Compute recall: fraction of true k-NN found by approximate search
 */
function computeRecall(
  approxResults: Array<{ id: string }>,
  groundTruth: Array<{ id: string }>
): number {
  const truthSet = new Set(groundTruth.map((r) => r.id))
  const hits = approxResults.filter((r) => truthSet.has(r.id)).length
  return hits / groundTruth.length
}

/**
 * Create a mock database for testing
 */
function createMockDb() {
  const data = new Map<string, any>()
  const events: any[] = []

  return {
    data,
    events,
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  }
}

// ============================================================================
// TESTS: HNSW Configuration and Initialization
// ============================================================================

describe('HNSWIndex - Configuration', () => {
  it('should create HNSW index with default configuration', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 128 })

    expect(index.dimensions).toBe(128)
    expect(index.M).toBe(16) // Default M
    expect(index.efConstruction).toBe(200) // Default efConstruction
    expect(index.efSearch).toBe(50) // Default efSearch
    expect(index.metric).toBe('cosine') // Default metric
  })

  it('should accept custom M parameter (8, 16, 32)', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index8 = new HNSWIndex({ dimensions: 128, M: 8 })
    expect(index8.M).toBe(8)

    const index16 = new HNSWIndex({ dimensions: 128, M: 16 })
    expect(index16.M).toBe(16)

    const index32 = new HNSWIndex({ dimensions: 128, M: 32 })
    expect(index32.M).toBe(32)
  })

  it('should compute maxLevel based on M and expected size', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({
      dimensions: 128,
      M: 16,
      expectedElements: 10000,
    })

    // maxLevel is typically computed as floor(log(N)/log(M))
    // For N=10000, M=16: log(10000)/log(16) ~ 3.32
    expect(index.maxLevel).toBeGreaterThanOrEqual(3)
    expect(index.maxLevel).toBeLessThanOrEqual(5)
  })

  it('should validate M is positive and reasonable', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    expect(() => new HNSWIndex({ dimensions: 128, M: 0 })).toThrow(/M.*positive/i)
    expect(() => new HNSWIndex({ dimensions: 128, M: -5 })).toThrow(/M.*positive/i)
    expect(() => new HNSWIndex({ dimensions: 128, M: 1000 })).toThrow(/M.*too large/i)
  })

  it('should validate efConstruction >= 2*M', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    // efConstruction should be at least 2*M for good graph connectivity
    expect(() =>
      new HNSWIndex({ dimensions: 128, M: 16, efConstruction: 10 })
    ).toThrow(/efConstruction.*at least.*2\*M/i)

    // This should work
    const index = new HNSWIndex({ dimensions: 128, M: 16, efConstruction: 32 })
    expect(index.efConstruction).toBe(32)
  })

  it('should support L2 distance metric', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 128, metric: 'l2' })
    expect(index.metric).toBe('l2')
  })

  it('should initialize with empty graph', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 128 })

    expect(index.size()).toBe(0)
    expect(index.getLevelStats()).toEqual([])
    expect(index.getEntryPoint()).toBeNull()
  })
})

// ============================================================================
// TESTS: Graph Construction with M Values
// ============================================================================

describe('HNSWIndex - Graph Construction (M values)', () => {
  it('should build graph with M=8 connections per layer', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 8, efConstruction: 100 })

    // Insert 100 vectors
    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    expect(index.size()).toBe(100)

    // Each node should have at most M connections at layer 0
    // and at most M/2 (M0) connections at higher layers
    const stats = index.getGraphStats()
    expect(stats.maxConnectionsLayer0).toBeLessThanOrEqual(8 * 2) // M * 2 for layer 0
    expect(stats.avgConnectionsLayer0).toBeGreaterThan(4) // Good connectivity
  })

  it('should build graph with M=16 connections per layer', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const stats = index.getGraphStats()
    expect(stats.maxConnectionsLayer0).toBeLessThanOrEqual(16 * 2)
    expect(stats.avgConnectionsLayer0).toBeGreaterThan(8)
  })

  it('should build graph with M=32 connections per layer', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 32, efConstruction: 150 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const stats = index.getGraphStats()
    expect(stats.maxConnectionsLayer0).toBeLessThanOrEqual(32 * 2)
    expect(stats.avgConnectionsLayer0).toBeGreaterThan(16)
  })

  it('should create multi-level graph structure', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    // Insert enough vectors to get multi-level structure
    for (let i = 0; i < 500; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const levelStats = index.getLevelStats()

    // Should have multiple levels
    expect(levelStats.length).toBeGreaterThan(1)

    // Higher levels should have fewer nodes (exponential decay)
    for (let i = 1; i < levelStats.length; i++) {
      expect(levelStats[i].nodeCount).toBeLessThan(levelStats[i - 1].nodeCount)
    }
  })

  it('should maintain entry point at highest level', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    await index.add('vec_0', randomNormalizedVector(64, 0))

    // First node should be entry point
    const entryPoint = index.getEntryPoint()
    expect(entryPoint).not.toBeNull()
    expect(entryPoint?.id).toBe('vec_0')

    // Insert more vectors
    for (let i = 1; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Entry point should be at the highest level
    const ep = index.getEntryPoint()
    const epLevel = index.getNodeLevel(ep!.id)
    const levelStats = index.getLevelStats()

    expect(epLevel).toBe(levelStats.length - 1)
  })

  it('should use randomized level selection with exponential decay', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({
      dimensions: 64,
      M: 16,
      efConstruction: 100,
      randomSeed: 42, // Fixed seed for reproducibility
    })

    // Insert many vectors
    for (let i = 0; i < 1000; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const levelStats = index.getLevelStats()

    // Level 0 should have all nodes
    expect(levelStats[0].nodeCount).toBe(1000)

    // Higher levels should have ~1/M fraction of previous level
    // With M=16, probability of higher level is 1/ln(M) ~ 0.36
    // So level 1 should have roughly 360 nodes, level 2 roughly 130, etc.
    if (levelStats.length > 1) {
      const ratio = levelStats[1].nodeCount / levelStats[0].nodeCount
      expect(ratio).toBeGreaterThan(0.1)
      expect(ratio).toBeLessThan(0.5)
    }
  })
})

// ============================================================================
// TESTS: efConstruction Impact on Quality
// ============================================================================

describe('HNSWIndex - efConstruction Impact', () => {
  it('should produce higher recall with larger efConstruction', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    // Create reference vectors
    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 500; i++) {
      vectors.set(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Low efConstruction
    const indexLow = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 32 })
    for (const [id, vec] of vectors) {
      await indexLow.add(id, vec)
    }

    // High efConstruction
    const indexHigh = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 200 })
    for (const [id, vec] of vectors) {
      await indexHigh.add(id, vec)
    }

    // Test recall on multiple queries
    let recallLow = 0
    let recallHigh = 0
    const numQueries = 50

    for (let q = 0; q < numQueries; q++) {
      const query = randomNormalizedVector(64, q * 1000)
      const groundTruth = bruteForceKNN(query, vectors, 10)

      const resultsLow = await indexLow.search(query, 10)
      const resultsHigh = await indexHigh.search(query, 10)

      recallLow += computeRecall(resultsLow, groundTruth)
      recallHigh += computeRecall(resultsHigh, groundTruth)
    }

    recallLow /= numQueries
    recallHigh /= numQueries

    // Higher efConstruction should produce better or equal recall
    // (both may achieve 100% recall on small datasets)
    expect(recallHigh).toBeGreaterThanOrEqual(recallLow)
  })

  it('should have slower construction with larger efConstruction', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const vectors: Array<{ id: string; vec: Float32Array }> = []
    for (let i = 0; i < 200; i++) {
      vectors.push({ id: `vec_${i}`, vec: randomNormalizedVector(64, i) })
    }

    // Time low efConstruction
    const indexLow = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 32 })
    const startLow = performance.now()
    for (const { id, vec } of vectors) {
      await indexLow.add(id, vec)
    }
    const timeLow = performance.now() - startLow

    // Time high efConstruction
    const indexHigh = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 200 })
    const startHigh = performance.now()
    for (const { id, vec } of vectors) {
      await indexHigh.add(id, vec)
    }
    const timeHigh = performance.now() - startHigh

    // Higher efConstruction should be slower
    expect(timeHigh).toBeGreaterThan(timeLow * 1.2)
  })

  it('should maintain minimum connectivity with low efConstruction', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    // Use minimum viable efConstruction (2*M)
    const index = new HNSWIndex({ dimensions: 64, M: 8, efConstruction: 16 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Graph should still be navigable
    const stats = index.getGraphStats()
    expect(stats.avgConnectionsLayer0).toBeGreaterThan(2) // Minimum connectivity
    expect(stats.disconnectedNodes).toBe(0) // No orphan nodes
  })
})

// ============================================================================
// TESTS: Approximate Nearest Neighbor Search
// ============================================================================

describe('HNSWIndex - ANN Search', () => {
  it('should find approximate nearest neighbors', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 200; i++) {
      const vec = randomNormalizedVector(64, i)
      vectors.set(`vec_${i}`, vec)
      await index.add(`vec_${i}`, vec)
    }

    const query = randomNormalizedVector(64, 100)
    const results = await index.search(query, 10)

    expect(results).toHaveLength(10)
    expect(results[0]).toHaveProperty('id')
    expect(results[0]).toHaveProperty('score')

    // Results should be sorted by score (descending for cosine)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
    }
  })

  it('should achieve high recall with proper parameters', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({
      dimensions: 64,
      M: 16,
      efConstruction: 200,
      efSearch: 100,
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 500; i++) {
      const vec = randomNormalizedVector(64, i)
      vectors.set(`vec_${i}`, vec)
      await index.add(`vec_${i}`, vec)
    }

    // Test recall
    let totalRecall = 0
    const numQueries = 50

    for (let q = 0; q < numQueries; q++) {
      const query = randomNormalizedVector(64, q * 1000)
      const groundTruth = bruteForceKNN(query, vectors, 10)
      const results = await index.search(query, 10)

      totalRecall += computeRecall(results, groundTruth)
    }

    const avgRecall = totalRecall / numQueries
    expect(avgRecall).toBeGreaterThan(0.9) // 90% recall minimum
  })

  it('should support efSearch parameter tuning', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 300; i++) {
      const vec = randomNormalizedVector(64, i)
      vectors.set(`vec_${i}`, vec)
      await index.add(`vec_${i}`, vec)
    }

    const query = randomNormalizedVector(64, 500)
    const groundTruth = bruteForceKNN(query, vectors, 10)

    // Low efSearch - faster but lower recall
    const resultsLow = await index.search(query, 10, { efSearch: 20 })
    const recallLow = computeRecall(resultsLow, groundTruth)

    // High efSearch - slower but higher recall
    const resultsHigh = await index.search(query, 10, { efSearch: 200 })
    const recallHigh = computeRecall(resultsHigh, groundTruth)

    expect(recallHigh).toBeGreaterThanOrEqual(recallLow)
  })

  it('should return search statistics', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 200; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const query = randomNormalizedVector(64, 100)
    const { results, stats } = await index.searchWithStats(query, 10)

    expect(results).toHaveLength(10)
    expect(stats).toHaveProperty('distanceComputations')
    expect(stats).toHaveProperty('nodesVisited')
    expect(stats).toHaveProperty('searchTimeMs')
    expect(stats).toHaveProperty('levelsTraversed')
    expect(stats.distanceComputations).toBeGreaterThan(0)
  })

  it('should work with L2 distance metric', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({
      dimensions: 64,
      M: 16,
      efConstruction: 100,
      metric: 'l2',
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 100; i++) {
      const vec = randomNormalizedVector(64, i)
      vectors.set(`vec_${i}`, vec)
      await index.add(`vec_${i}`, vec)
    }

    const query = randomNormalizedVector(64, 50)
    const results = await index.search(query, 10)

    expect(results).toHaveLength(10)

    // For L2, lower score is better (distance)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i + 1].score)
    }
  })

  it('should handle empty index gracefully', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16 })

    const query = randomNormalizedVector(64, 42)
    const results = await index.search(query, 10)

    expect(results).toEqual([])
  })

  it('should return exact matches when available', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    const targetVec = randomNormalizedVector(64, 42)
    await index.add('target', targetVec)

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Search with the exact vector
    const results = await index.search(targetVec, 1)

    expect(results[0].id).toBe('target')
    expect(results[0].score).toBeCloseTo(1.0, 5) // Cosine similarity = 1 for identical
  })
})

// ============================================================================
// TESTS: Dynamic Insertion
// ============================================================================

describe('HNSWIndex - Dynamic Insertion', () => {
  it('should insert single vector', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16 })

    await index.add('vec_0', randomNormalizedVector(64, 0))

    expect(index.size()).toBe(1)
    expect(index.has('vec_0')).toBe(true)
  })

  it('should insert multiple vectors incrementally', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
      expect(index.size()).toBe(i + 1)
    }
  })

  it('should maintain graph connectivity after insertions', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 200; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const stats = index.getGraphStats()
    expect(stats.disconnectedNodes).toBe(0)
    expect(stats.avgConnectionsLayer0).toBeGreaterThan(4)
  })

  it('should reject duplicate IDs', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16 })

    await index.add('vec_dup', randomNormalizedVector(64, 1))

    await expect(index.add('vec_dup', randomNormalizedVector(64, 2))).rejects.toThrow(
      /duplicate|already exists/i
    )
  })

  it('should validate vector dimension on insert', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16 })

    await expect(index.add('vec_wrong', randomNormalizedVector(128, 1))).rejects.toThrow(
      /dimension.*mismatch/i
    )
  })

  it('should update entry point when inserting node at higher level', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({
      dimensions: 64,
      M: 16,
      efConstruction: 100,
      randomSeed: 42,
    })

    await index.add('vec_0', randomNormalizedVector(64, 0))
    const initialEntryPoint = index.getEntryPoint()

    // Insert more vectors - entry point may change
    for (let i = 1; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const finalEntryPoint = index.getEntryPoint()
    const entryLevel = index.getNodeLevel(finalEntryPoint!.id)
    const levelStats = index.getLevelStats()

    // Entry point should be at highest level
    expect(entryLevel).toBe(levelStats.length - 1)
  })

  it('should batch insert for efficiency', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    const vectors = Array.from({ length: 100 }, (_, i) => ({
      id: `vec_${i}`,
      vector: randomNormalizedVector(64, i),
    }))

    await index.addBatch(vectors)

    expect(index.size()).toBe(100)
  })
})

// ============================================================================
// TESTS: Dynamic Deletion
// ============================================================================

describe('HNSWIndex - Dynamic Deletion', () => {
  it('should delete a single vector', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 10; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    await index.delete('vec_5')

    expect(index.size()).toBe(9)
    expect(index.has('vec_5')).toBe(false)
  })

  it('should maintain graph connectivity after deletion', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Delete 20% of nodes
    for (let i = 0; i < 20; i++) {
      await index.delete(`vec_${i * 5}`)
    }

    expect(index.size()).toBe(80)

    const stats = index.getGraphStats()
    expect(stats.disconnectedNodes).toBe(0)
  })

  it('should repair neighbor links after deletion', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 50; i++) {
      const vec = randomNormalizedVector(64, i)
      vectors.set(`vec_${i}`, vec)
      await index.add(`vec_${i}`, vec)
    }

    // Delete some nodes
    vectors.delete('vec_25')
    await index.delete('vec_25')

    // Search should still work correctly
    const query = randomNormalizedVector(64, 25)
    const results = await index.search(query, 10)

    expect(results.every((r) => r.id !== 'vec_25')).toBe(true)
  })

  it('should handle deletion of entry point', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const entryPoint = index.getEntryPoint()
    await index.delete(entryPoint!.id)

    // Should have a new entry point
    const newEntryPoint = index.getEntryPoint()
    expect(newEntryPoint).not.toBeNull()
    expect(newEntryPoint!.id).not.toBe(entryPoint!.id)
  })

  it('should handle deleting non-existent vector gracefully', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16 })

    await index.add('vec_0', randomNormalizedVector(64, 0))

    // Should not throw
    const result = await index.delete('non_existent')
    expect(result).toBe(false)
  })

  it('should support soft deletion with tombstones', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({
      dimensions: 64,
      M: 16,
      efConstruction: 100,
      useTombstones: true,
    })

    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Soft delete
    await index.delete('vec_25', { soft: true })

    // Should not appear in search results
    const query = randomNormalizedVector(64, 25)
    const results = await index.search(query, 50)
    expect(results.every((r) => r.id !== 'vec_25')).toBe(true)

    // But should be recoverable
    expect(index.hasDeleted('vec_25')).toBe(true)
    await index.undelete('vec_25')

    const resultsAfter = await index.search(query, 50)
    expect(resultsAfter.some((r) => r.id === 'vec_25')).toBe(true)
  })

  it('should compact tombstones periodically', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({
      dimensions: 64,
      M: 16,
      efConstruction: 100,
      useTombstones: true,
    })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Soft delete many nodes
    for (let i = 0; i < 30; i++) {
      await index.delete(`vec_${i}`, { soft: true })
    }

    expect(index.getTombstoneCount()).toBe(30)

    // Compact - should permanently remove tombstones
    await index.compact()

    expect(index.getTombstoneCount()).toBe(0)
    expect(index.size()).toBe(70)
  })
})

// ============================================================================
// TESTS: Multi-Level Graph Navigation
// ============================================================================

describe('HNSWIndex - Multi-Level Navigation', () => {
  it('should start search from entry point at highest level', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 500; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const query = randomNormalizedVector(64, 250)
    const { stats } = await index.searchWithStats(query, 10)

    const levelStats = index.getLevelStats()
    expect(stats.startLevel).toBe(levelStats.length - 1)
  })

  it('should greedily traverse each level before descending', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 300; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const query = randomNormalizedVector(64, 150)
    const { stats } = await index.searchWithStats(query, 10)

    // Should visit nodes at multiple levels
    expect(stats.nodesVisitedPerLevel.length).toBeGreaterThan(1)

    // Higher levels should have fewer visits (express routes)
    const visits = stats.nodesVisitedPerLevel
    for (let i = 1; i < visits.length; i++) {
      expect(visits[visits.length - i]).toBeLessThanOrEqual(visits[visits.length - i - 1])
    }
  })

  it('should expand search candidate list at layer 0', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({
      dimensions: 64,
      M: 16,
      efConstruction: 100,
      efSearch: 50,
    })

    for (let i = 0; i < 200; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const query = randomNormalizedVector(64, 100)
    const { stats } = await index.searchWithStats(query, 10)

    // At layer 0, should explore up to efSearch candidates
    expect(stats.candidatesExploredLayer0).toBeLessThanOrEqual(50)
    expect(stats.candidatesExploredLayer0).toBeGreaterThan(10)
  })

  it('should correctly handle level probability', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({
      dimensions: 64,
      M: 16,
      efConstruction: 100,
      randomSeed: 123,
    })

    // Insert many vectors to get stable level distribution
    for (let i = 0; i < 2000; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const levelStats = index.getLevelStats()

    // Check exponential decay pattern
    // Probability of being at level l is (1/M)^l
    // So level 0 has all 2000, level 1 should have ~125 (1/16), etc.
    for (let l = 1; l < levelStats.length - 1; l++) {
      const ratio = levelStats[l].nodeCount / levelStats[l - 1].nodeCount
      // Should be roughly 1/M with some variance
      expect(ratio).toBeGreaterThan(0.02)
      expect(ratio).toBeLessThan(0.3)
    }
  })
})

// ============================================================================
// TESTS: Persistence to SQLite
// ============================================================================

describe('HNSWIndex - Persistence', () => {
  it('should serialize graph to SQLite', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const db = createMockDb()
    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    await index.saveToSQLite(db)

    // Should have called db.exec to create tables
    expect(db.exec).toHaveBeenCalled()
    const calls = db.exec.mock.calls.flat().join('\n')
    expect(calls).toMatch(/CREATE.*TABLE.*hnsw_nodes/i)
    expect(calls).toMatch(/CREATE.*TABLE.*hnsw_edges/i)
    expect(calls).toMatch(/CREATE.*TABLE.*hnsw_metadata/i)
  })

  it('should store node vectors and levels', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const db = createMockDb()
    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 30; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    await index.saveToSQLite(db)

    // Should have prepared statements for inserting nodes
    expect(db.prepare).toHaveBeenCalled()
    const prepCalls = db.prepare.mock.calls.flat()
    expect(prepCalls.some((sql: string) => sql.match(/INSERT.*hnsw_nodes/i))).toBe(true)
  })

  it('should store bidirectional edge lists per layer', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const db = createMockDb()
    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    await index.saveToSQLite(db)

    const prepCalls = db.prepare.mock.calls.flat()
    expect(prepCalls.some((sql: string) => sql.match(/INSERT.*hnsw_edges/i))).toBe(true)
  })

  it('should store configuration and entry point', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const db = createMockDb()
    const index = new HNSWIndex({
      dimensions: 64,
      M: 16,
      efConstruction: 100,
      metric: 'cosine',
    })

    for (let i = 0; i < 20; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    await index.saveToSQLite(db)

    const prepCalls = db.prepare.mock.calls.flat()
    expect(prepCalls.some((sql: string) => sql.match(/INSERT.*hnsw_metadata/i))).toBe(true)
  })

  it('should deserialize graph from SQLite', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    // Create and populate index
    const originalIndex = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })
    const vectors = new Map<string, Float32Array>()

    for (let i = 0; i < 50; i++) {
      const vec = randomNormalizedVector(64, i)
      vectors.set(`vec_${i}`, vec)
      await originalIndex.add(`vec_${i}`, vec)
    }

    // Serialize to buffer (in-memory simulation)
    const serialized = await originalIndex.serialize()

    // Deserialize
    const loadedIndex = await HNSWIndex.deserialize(serialized)

    expect(loadedIndex.size()).toBe(50)
    expect(loadedIndex.dimensions).toBe(64)
    expect(loadedIndex.M).toBe(16)

    // Search should work on loaded index
    const query = randomNormalizedVector(64, 25)
    const results = await loadedIndex.search(query, 10)
    expect(results).toHaveLength(10)
  })

  it('should preserve search quality after deserialization', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const originalIndex = new HNSWIndex({
      dimensions: 64,
      M: 16,
      efConstruction: 100,
      efSearch: 50,
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 100; i++) {
      const vec = randomNormalizedVector(64, i)
      vectors.set(`vec_${i}`, vec)
      await originalIndex.add(`vec_${i}`, vec)
    }

    // Test recall on original
    const query = randomNormalizedVector(64, 50)
    const groundTruth = bruteForceKNN(query, vectors, 10)
    const originalResults = await originalIndex.search(query, 10)
    const originalRecall = computeRecall(originalResults, groundTruth)

    // Serialize and deserialize
    const serialized = await originalIndex.serialize()
    const loadedIndex = await HNSWIndex.deserialize(serialized)

    // Test recall on loaded
    const loadedResults = await loadedIndex.search(query, 10)
    const loadedRecall = computeRecall(loadedResults, groundTruth)

    // Should have same recall
    expect(loadedRecall).toBe(originalRecall)
  })

  it('should support incremental updates after load', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const originalIndex = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 30; i++) {
      await originalIndex.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const serialized = await originalIndex.serialize()
    const loadedIndex = await HNSWIndex.deserialize(serialized)

    // Add more vectors after loading
    for (let i = 30; i < 50; i++) {
      await loadedIndex.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    expect(loadedIndex.size()).toBe(50)

    // Delete some
    await loadedIndex.delete('vec_10')
    expect(loadedIndex.size()).toBe(49)
  })

  it('should store graph in compact binary format', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const serialized = await index.serialize()

    // Should be ArrayBuffer
    expect(serialized).toBeInstanceOf(ArrayBuffer)

    // Size estimate: 100 vectors * 64 dims * 4 bytes + graph overhead
    // Graph: 100 nodes * ~16 edges * 4 bytes per edge reference
    const expectedMinSize = 100 * 64 * 4
    const expectedMaxSize = expectedMinSize * 3 // Allow 3x for overhead

    expect(serialized.byteLength).toBeGreaterThan(expectedMinSize)
    expect(serialized.byteLength).toBeLessThan(expectedMaxSize)
  })
})

// ============================================================================
// TESTS: Recall vs Speed Tradeoffs
// ============================================================================

describe('HNSWIndex - Recall vs Speed Tradeoffs', () => {
  it('should trade off recall for speed with different efSearch values', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 200 })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 1000; i++) {
      const vec = randomNormalizedVector(64, i)
      vectors.set(`vec_${i}`, vec)
      await index.add(`vec_${i}`, vec)
    }

    const efSearchValues = [10, 50, 100, 200]
    const results: Array<{ efSearch: number; avgRecall: number; avgTime: number }> = []

    for (const efSearch of efSearchValues) {
      let totalRecall = 0
      let totalTime = 0
      const numQueries = 20

      for (let q = 0; q < numQueries; q++) {
        const query = randomNormalizedVector(64, q * 100)
        const groundTruth = bruteForceKNN(query, vectors, 10)

        const start = performance.now()
        const searchResults = await index.search(query, 10, { efSearch })
        totalTime += performance.now() - start

        totalRecall += computeRecall(searchResults, groundTruth)
      }

      results.push({
        efSearch,
        avgRecall: totalRecall / numQueries,
        avgTime: totalTime / numQueries,
      })
    }

    // Higher efSearch should have higher recall
    for (let i = 1; i < results.length; i++) {
      expect(results[i].avgRecall).toBeGreaterThanOrEqual(results[i - 1].avgRecall * 0.99) // Allow small variance
    }

    // Higher efSearch should be slower
    for (let i = 1; i < results.length; i++) {
      expect(results[i].avgTime).toBeGreaterThan(results[i - 1].avgTime * 0.8) // Allow some variance
    }
  })

  it('should achieve 99%+ recall with high efSearch', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({
      dimensions: 64,
      M: 32,
      efConstruction: 200,
      efSearch: 300,
    })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 500; i++) {
      const vec = randomNormalizedVector(64, i)
      vectors.set(`vec_${i}`, vec)
      await index.add(`vec_${i}`, vec)
    }

    let totalRecall = 0
    const numQueries = 50

    for (let q = 0; q < numQueries; q++) {
      const query = randomNormalizedVector(64, q * 100)
      const groundTruth = bruteForceKNN(query, vectors, 10)
      const searchResults = await index.search(query, 10)

      totalRecall += computeRecall(searchResults, groundTruth)
    }

    const avgRecall = totalRecall / numQueries
    expect(avgRecall).toBeGreaterThan(0.99)
  })

  it('should provide latency statistics', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 500; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Run multiple searches
    for (let q = 0; q < 50; q++) {
      await index.search(randomNormalizedVector(64, q), 10)
    }

    const latencyStats = index.getLatencyStats()

    expect(latencyStats).toHaveProperty('searchCount')
    expect(latencyStats).toHaveProperty('avgLatencyMs')
    expect(latencyStats).toHaveProperty('p50LatencyMs')
    expect(latencyStats).toHaveProperty('p99LatencyMs')
    expect(latencyStats.searchCount).toBe(50)
    expect(latencyStats.avgLatencyMs).toBeGreaterThan(0)
  })

  it('should provide recall evaluation interface', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    const vectors = new Map<string, Float32Array>()
    for (let i = 0; i < 200; i++) {
      const vec = randomNormalizedVector(64, i)
      vectors.set(`vec_${i}`, vec)
      await index.add(`vec_${i}`, vec)
    }

    const queries = Array.from({ length: 20 }, (_, q) => randomNormalizedVector(64, q * 100))

    const recallMetrics = await index.evaluateRecall(queries, {
      k: 10,
      efSearchValues: [20, 50, 100],
      groundTruthFn: (query, k) => bruteForceKNN(query, vectors, k),
    })

    expect(recallMetrics).toHaveLength(3)
    for (const metric of recallMetrics) {
      expect(metric).toHaveProperty('efSearch')
      expect(metric).toHaveProperty('meanRecall')
      expect(metric.meanRecall).toBeGreaterThan(0)
      expect(metric.meanRecall).toBeLessThanOrEqual(1)
    }
  })

  it('should balance M value impact on recall and memory', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const mValues = [8, 16, 32]
    const results: Array<{
      M: number
      avgRecall: number
      memoryBytes: number
      avgSearchTime: number
    }> = []

    for (const M of mValues) {
      const index = new HNSWIndex({ dimensions: 64, M, efConstruction: 100 })

      const vectors = new Map<string, Float32Array>()
      for (let i = 0; i < 300; i++) {
        const vec = randomNormalizedVector(64, i)
        vectors.set(`vec_${i}`, vec)
        await index.add(`vec_${i}`, vec)
      }

      let totalRecall = 0
      let totalTime = 0
      const numQueries = 20

      for (let q = 0; q < numQueries; q++) {
        const query = randomNormalizedVector(64, q * 100)
        const groundTruth = bruteForceKNN(query, vectors, 10)

        const start = performance.now()
        const searchResults = await index.search(query, 10)
        totalTime += performance.now() - start

        totalRecall += computeRecall(searchResults, groundTruth)
      }

      const stats = index.getStats()
      results.push({
        M,
        avgRecall: totalRecall / numQueries,
        memoryBytes: stats.memoryUsageBytes,
        avgSearchTime: totalTime / numQueries,
      })
    }

    // Higher M should have higher memory usage
    expect(results[1].memoryBytes).toBeGreaterThan(results[0].memoryBytes)
    expect(results[2].memoryBytes).toBeGreaterThan(results[1].memoryBytes)

    // Higher M should generally have better or equal recall
    expect(results[1].avgRecall).toBeGreaterThanOrEqual(results[0].avgRecall * 0.95)
    expect(results[2].avgRecall).toBeGreaterThanOrEqual(results[1].avgRecall * 0.95)
  })
})

// ============================================================================
// TESTS: Graph Serialization/Deserialization
// ============================================================================

describe('HNSWIndex - Graph Serialization', () => {
  it('should serialize to JSON format', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 30; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const json = await index.toJSON()

    expect(json).toHaveProperty('config')
    expect(json.config.dimensions).toBe(64)
    expect(json.config.M).toBe(16)
    expect(json.config.efConstruction).toBe(100)

    expect(json).toHaveProperty('nodes')
    expect(json.nodes.length).toBe(30)

    expect(json).toHaveProperty('edges')
    expect(json).toHaveProperty('entryPoint')
    expect(json).toHaveProperty('levelStats')
  })

  it('should deserialize from JSON format', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const originalIndex = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 30; i++) {
      await originalIndex.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const json = await originalIndex.toJSON()
    const loadedIndex = await HNSWIndex.fromJSON(json)

    expect(loadedIndex.size()).toBe(30)
    expect(loadedIndex.dimensions).toBe(64)
    expect(loadedIndex.M).toBe(16)
  })

  it('should serialize to compact binary format', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const buffer = await index.serialize()

    expect(buffer).toBeInstanceOf(ArrayBuffer)

    // Check magic bytes
    const view = new DataView(buffer)
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    expect(magic).toBe('HNSW')
  })

  it('should deserialize from compact binary format', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const originalIndex = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 50; i++) {
      await originalIndex.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const buffer = await originalIndex.serialize()
    const loadedIndex = await HNSWIndex.deserialize(buffer)

    expect(loadedIndex.size()).toBe(50)

    // Search should work
    const query = randomNormalizedVector(64, 25)
    const results = await loadedIndex.search(query, 10)
    expect(results).toHaveLength(10)
  })

  it('should validate format version on deserialize', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    // Create invalid buffer with wrong magic
    const invalidBuffer = new ArrayBuffer(100)
    const view = new DataView(invalidBuffer)
    view.setUint8(0, 'I'.charCodeAt(0))
    view.setUint8(1, 'N'.charCodeAt(0))
    view.setUint8(2, 'V'.charCodeAt(0))
    view.setUint8(3, 'L'.charCodeAt(0))

    await expect(HNSWIndex.deserialize(invalidBuffer)).rejects.toThrow(/invalid.*format|magic/i)
  })

  it('should preserve all node connections on round-trip', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const originalIndex = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 50; i++) {
      await originalIndex.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const originalStats = originalIndex.getGraphStats()
    const buffer = await originalIndex.serialize()
    const loadedIndex = await HNSWIndex.deserialize(buffer)
    const loadedStats = loadedIndex.getGraphStats()

    expect(loadedStats.totalEdges).toBe(originalStats.totalEdges)
    expect(loadedStats.avgConnectionsLayer0).toBeCloseTo(originalStats.avgConnectionsLayer0, 5)
  })
})

// ============================================================================
// TESTS: Incremental Index Updates
// ============================================================================

describe('HNSWIndex - Incremental Updates', () => {
  it('should update vector embedding in place', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    const originalVec = randomNormalizedVector(64, 1)
    await index.add('vec_update', originalVec)

    const newVec = randomNormalizedVector(64, 2)
    await index.update('vec_update', newVec)

    // Search should find the new vector
    const results = await index.search(newVec, 1)
    expect(results[0].id).toBe('vec_update')
    expect(results[0].score).toBeCloseTo(1.0, 5)

    // Old vector should not match as well
    const oldResults = await index.search(originalVec, 1)
    expect(oldResults[0].score).toBeLessThan(0.99)
  })

  it('should rebuild connections on update', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    // Create cluster of similar vectors
    for (let i = 0; i < 20; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Update vec_10 to be similar to vec_0
    const vec0 = await index.getVector('vec_0')
    await index.update('vec_10', vec0!)

    // vec_10 should now be connected to vec_0's neighbors
    const neighbors = index.getNeighbors('vec_10', 0)
    expect(neighbors.some((n) => n.id === 'vec_0' || neighbors.some((nn) => nn.id === 'vec_0'))).toBe(true)
  })

  it('should preserve size after updates', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    expect(index.size()).toBe(50)

    // Update multiple vectors
    for (let i = 0; i < 10; i++) {
      await index.update(`vec_${i}`, randomNormalizedVector(64, i + 100))
    }

    expect(index.size()).toBe(50) // Size should not change
  })

  it('should throw error on update of non-existent vector', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16 })

    await expect(index.update('non_existent', randomNormalizedVector(64, 1))).rejects.toThrow(
      /not found|does not exist/i
    )
  })

  it('should support upsert operation', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    // Upsert new vector
    await index.upsert('vec_1', randomNormalizedVector(64, 1))
    expect(index.size()).toBe(1)

    // Upsert existing vector
    const newVec = randomNormalizedVector(64, 2)
    await index.upsert('vec_1', newVec)
    expect(index.size()).toBe(1)

    // Should have updated value
    const results = await index.search(newVec, 1)
    expect(results[0].id).toBe('vec_1')
    expect(results[0].score).toBeCloseTo(1.0, 5)
  })

  it('should handle concurrent modifications safely', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    // Initial population
    for (let i = 0; i < 50; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Concurrent operations
    const ops = [
      index.add('vec_new', randomNormalizedVector(64, 100)),
      index.delete('vec_10'),
      index.update('vec_20', randomNormalizedVector(64, 200)),
      index.search(randomNormalizedVector(64, 25), 10),
    ]

    await Promise.all(ops)

    // Index should be in consistent state
    expect(index.size()).toBe(50) // Added 1, deleted 1
    expect(index.has('vec_new')).toBe(true)
    expect(index.has('vec_10')).toBe(false)
  })
})

// ============================================================================
// TESTS: Statistics and Diagnostics
// ============================================================================

describe('HNSWIndex - Statistics', () => {
  it('should provide comprehensive graph statistics', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 200; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const stats = index.getStats()

    expect(stats).toHaveProperty('vectorCount')
    expect(stats.vectorCount).toBe(200)

    expect(stats).toHaveProperty('dimensions')
    expect(stats.dimensions).toBe(64)

    expect(stats).toHaveProperty('M')
    expect(stats.M).toBe(16)

    expect(stats).toHaveProperty('efConstruction')
    expect(stats.efConstruction).toBe(100)

    expect(stats).toHaveProperty('metric')
    expect(stats.metric).toBe('cosine')

    expect(stats).toHaveProperty('memoryUsageBytes')
    expect(stats.memoryUsageBytes).toBeGreaterThan(0)

    expect(stats).toHaveProperty('numLevels')
    expect(stats.numLevels).toBeGreaterThan(0)
  })

  it('should provide per-level statistics', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 500; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const levelStats = index.getLevelStats()

    expect(Array.isArray(levelStats)).toBe(true)
    expect(levelStats.length).toBeGreaterThan(1)

    for (const stat of levelStats) {
      expect(stat).toHaveProperty('level')
      expect(stat).toHaveProperty('nodeCount')
      expect(stat).toHaveProperty('avgConnections')
      expect(stat).toHaveProperty('maxConnections')
    }

    // Level 0 should have all nodes
    expect(levelStats[0].nodeCount).toBe(500)
  })

  it('should provide graph connectivity metrics', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const graphStats = index.getGraphStats()

    expect(graphStats).toHaveProperty('totalEdges')
    expect(graphStats).toHaveProperty('avgConnectionsLayer0')
    expect(graphStats).toHaveProperty('maxConnectionsLayer0')
    expect(graphStats).toHaveProperty('disconnectedNodes')

    expect(graphStats.totalEdges).toBeGreaterThan(0)
    expect(graphStats.avgConnectionsLayer0).toBeGreaterThan(4)
    expect(graphStats.disconnectedNodes).toBe(0)
  })

  it('should track search performance metrics', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 200; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    // Run some searches
    for (let i = 0; i < 30; i++) {
      await index.search(randomNormalizedVector(64, i), 10)
    }

    const perfStats = index.getPerformanceStats()

    expect(perfStats).toHaveProperty('totalSearches')
    expect(perfStats.totalSearches).toBe(30)

    expect(perfStats).toHaveProperty('avgDistanceComputations')
    expect(perfStats).toHaveProperty('avgNodesVisited')
    expect(perfStats).toHaveProperty('avgSearchTimeMs')
  })

  it('should estimate memory usage accurately', async () => {
    assertModuleLoaded('HNSWIndex', HNSWIndex)

    const index = new HNSWIndex({ dimensions: 64, M: 16, efConstruction: 100 })

    for (let i = 0; i < 100; i++) {
      await index.add(`vec_${i}`, randomNormalizedVector(64, i))
    }

    const stats = index.getStats()

    // Memory estimate: vectors + graph structure
    // Vectors: 100 * 64 * 4 = 25,600 bytes
    // Graph: 100 nodes * ~16 edges * 4 bytes per edge = ~6,400 bytes
    // Total: ~32,000 bytes minimum
    expect(stats.memoryUsageBytes).toBeGreaterThan(25000)
    expect(stats.memoryUsageBytes).toBeLessThan(100000)
  })
})

// ============================================================================
// TESTS: Factory Function
// ============================================================================

describe('HNSWIndex - Factory Function', () => {
  it('should create index via factory function', async () => {
    assertModuleLoaded('createHNSWIndex', createHNSWIndex)

    const index = createHNSWIndex({
      dimensions: 128,
      M: 32,
      efConstruction: 200,
      metric: 'cosine',
    })

    expect(index.dimensions).toBe(128)
    expect(index.M).toBe(32)
    expect(index.efConstruction).toBe(200)
  })

  it('should create index with presets', async () => {
    assertModuleLoaded('createHNSWIndex', createHNSWIndex)

    const fastIndex = createHNSWIndex({
      dimensions: 128,
      preset: 'fast', // Low M, low efConstruction
    })

    const accurateIndex = createHNSWIndex({
      dimensions: 128,
      preset: 'accurate', // High M, high efConstruction
    })

    expect(fastIndex.M).toBeLessThan(accurateIndex.M)
    expect(fastIndex.efConstruction).toBeLessThan(accurateIndex.efConstruction)
  })

  it('should auto-tune parameters based on expected size', async () => {
    assertModuleLoaded('createHNSWIndex', createHNSWIndex)

    const smallIndex = createHNSWIndex({
      dimensions: 128,
      expectedElements: 1000,
      autoTune: true,
    })

    const largeIndex = createHNSWIndex({
      dimensions: 128,
      expectedElements: 1000000,
      autoTune: true,
    })

    // Large index should have higher M for better graph quality
    expect(largeIndex.M).toBeGreaterThanOrEqual(smallIndex.M)
  })
})
