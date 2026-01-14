/**
 * Vector Progressive Search Benchmarks
 *
 * GREEN PHASE: Measures performance of progressive vector search stages.
 *
 * The progressive search pipeline uses multi-stage filtering:
 * 1. Binary hash prefilter (fastest, most coarse) - Hamming distance
 * 2. Matryoshka 64d search (fast, coarse) - Truncated embeddings
 * 3. Matryoshka 256d search (medium) - Higher fidelity truncation
 * 4. Full 1536d search (slowest, most accurate) - Full precision
 *
 * Trade-offs:
 * - Binary: O(1) comparison, 32x compression, ~90% recall
 * - 64d: 24x speedup vs 1536d, ~95% recall
 * - 256d: 6x speedup vs 1536d, ~99% recall
 * - 1536d: Baseline accuracy, highest latency
 *
 * @see do-p7v - GREEN: Cross-Store Comparison Implementation
 */

import { describe, bench, beforeAll, afterAll } from 'vitest'
import { VectorGenerator } from '../datasets/vectors'
import { CostTracker } from '../framework/cost-tracker'
import {
  createComparisonVectorStore,
  type ComparisonVectorStore,
} from './harness'

describe('Vector Progressive Search Stages', () => {
  const generator = new VectorGenerator()
  let vectorStore: ComparisonVectorStore
  let queryVector: number[]
  let tracker: CostTracker

  beforeAll(async () => {
    // Generate query vector for all benchmarks
    queryVector = generator.generateSync({
      size: 1,
      dimension: 1536,
      seed: 42,
    })[0].embedding

    vectorStore = createComparisonVectorStore()
    tracker = new CostTracker()

    // Pre-populate with some vectors
    const vectors = generator.generateSync({ size: 100, dimension: 1536, seed: 123 })
    for (const vec of vectors) {
      await vectorStore.insert({ id: vec.$id, embedding: vec.embedding })
    }
  })

  afterAll(async () => {
    console.log('Vector Search Cost:', tracker.toMetrics())
  })

  // =========================================================================
  // STAGE 1: Binary Hash Prefilter
  // =========================================================================

  describe('Stage 1: Binary Hash Prefilter', () => {
    bench('binary quantization', () => {
      // Convert float32 vector to binary (0/1 based on sign)
      const binaryQuery = queryVector.map((v) => (v > 0 ? 1 : 0))
      // Result: 1536 bits = 192 bytes (vs 6144 bytes for float32)
    })

    bench('binary hash lookup (1000 candidates)', async () => {
      const binaryQuery = queryVector.map((v) => (v > 0 ? 1 : 0))
      await vectorStore?.binarySearch(binaryQuery, { limit: 1000 })
      // Expected: <1ms for 1M vectors using binary index
    })

    bench('hamming distance filter (maxDistance: 100)', async () => {
      await vectorStore?.hammingFilter(queryVector, { maxDistance: 100 })
      // Filters to vectors within 100 bit flips
    })

    bench('hamming distance filter (maxDistance: 200)', async () => {
      await vectorStore?.hammingFilter(queryVector, { maxDistance: 200 })
      // More permissive filter, more candidates
    })

    bench('hamming distance calculation (single pair)', () => {
      // Simulate hamming distance between two binary vectors
      const a = new Uint8Array(192) // 1536 bits
      const b = new Uint8Array(192)
      a.fill(0xaa)
      b.fill(0x55)

      let distance = 0
      for (let i = 0; i < 192; i++) {
        let xor = a[i] ^ b[i]
        while (xor) {
          distance += xor & 1
          xor >>= 1
        }
      }
      // Expected: popcount is very fast
    })
  })

  // =========================================================================
  // STAGE 2: Matryoshka 64d Search
  // =========================================================================

  describe('Stage 2: Matryoshka 64d', () => {
    bench('truncate to 64d', () => {
      const truncated = queryVector.slice(0, 64)
      // 24x dimension reduction
    })

    bench('search with 64d truncation (100 candidates)', async () => {
      const truncated = queryVector.slice(0, 64)
      await vectorStore?.search({ embedding: new Float32Array(truncated), limit: 100 })
      // Expected: ~24x faster than 1536d
    })

    bench('search with 64d truncation (500 candidates)', async () => {
      const truncated = queryVector.slice(0, 64)
      await vectorStore?.search({ embedding: new Float32Array(truncated), limit: 500 })
    })

    bench('cosine similarity 64d (single pair)', () => {
      const a = queryVector.slice(0, 64)
      const b = generator.generateSync({ size: 1, dimension: 64, seed: 123 })[0].embedding

      let dotProduct = 0
      let normA = 0
      let normB = 0
      for (let i = 0; i < 64; i++) {
        dotProduct += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
      }
      const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
    })
  })

  // =========================================================================
  // STAGE 3: Matryoshka 256d Search
  // =========================================================================

  describe('Stage 3: Matryoshka 256d', () => {
    bench('truncate to 256d', () => {
      const truncated = queryVector.slice(0, 256)
      // 6x dimension reduction
    })

    bench('search with 256d truncation (50 candidates)', async () => {
      const truncated = queryVector.slice(0, 256)
      await vectorStore?.search({ embedding: new Float32Array(truncated), limit: 50 })
      // Expected: ~6x faster than 1536d
    })

    bench('search with 256d truncation (100 candidates)', async () => {
      const truncated = queryVector.slice(0, 256)
      await vectorStore?.search({ embedding: new Float32Array(truncated), limit: 100 })
    })

    bench('cosine similarity 256d (single pair)', () => {
      const a = queryVector.slice(0, 256)
      const b = generator.generateSync({ size: 1, dimension: 256, seed: 123 })[0].embedding

      let dotProduct = 0
      let normA = 0
      let normB = 0
      for (let i = 0; i < 256; i++) {
        dotProduct += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
      }
      const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
    })
  })

  // =========================================================================
  // STAGE 4: Full 1536d Search
  // =========================================================================

  describe('Stage 4: Full 1536d', () => {
    bench('search with full dimensions (10 results)', async () => {
      await vectorStore?.search({ embedding: new Float32Array(queryVector), limit: 10 })
      // Baseline accuracy, highest latency
    })

    bench('search with full dimensions (50 results)', async () => {
      await vectorStore?.search({ embedding: new Float32Array(queryVector), limit: 50 })
    })

    bench('cosine similarity 1536d (single pair)', () => {
      const a = queryVector
      const b = generator.generateSync({ size: 1, dimension: 1536, seed: 123 })[0].embedding

      let dotProduct = 0
      let normA = 0
      let normB = 0
      for (let i = 0; i < 1536; i++) {
        dotProduct += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
      }
      const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
    })
  })

  // =========================================================================
  // COMBINED PROGRESSIVE SEARCH
  // =========================================================================

  describe('Combined Progressive Search', () => {
    bench('full progressive pipeline (binary -> 64d -> 256d -> 1536d)', async () => {
      // Stage 1: Binary prefilter to 1000 candidates
      const binaryQuery = queryVector.map((v) => (v > 0 ? 1 : 0))
      const stage1 = await vectorStore?.binarySearch(binaryQuery, { limit: 1000 })

      // Stage 2: Matryoshka 64d to 100 candidates
      const stage2 = await vectorStore?.refineSearch(
        queryVector.slice(0, 64),
        stage1 || [],
        { limit: 100 }
      )

      // Stage 3: Matryoshka 256d to 20 candidates
      const stage3 = await vectorStore?.refineSearch(
        queryVector.slice(0, 256),
        stage2 || [],
        { limit: 20 }
      )

      // Stage 4: Full 1536d for final 10
      const results = await vectorStore?.refineSearch(
        queryVector,
        stage3 || [],
        { limit: 10 }
      )

      return results
    })

    bench('progressive pipeline (64d -> 256d -> 1536d, skip binary)', async () => {
      // Stage 1: Matryoshka 64d to 500 candidates
      const stage1 = await vectorStore?.search({
        embedding: new Float32Array(queryVector.slice(0, 64)),
        limit: 500,
      })

      // Stage 2: Matryoshka 256d to 50 candidates
      const stage1Ids = stage1?.map((r: any) => r.id) || []
      const stage2 = await vectorStore?.refineSearch(
        queryVector.slice(0, 256),
        stage1Ids,
        { limit: 50 }
      )

      // Stage 3: Full 1536d for final 10
      const results = await vectorStore?.refineSearch(
        queryVector,
        stage2 || [],
        { limit: 10 }
      )

      return results
    })

    bench('progressive pipeline (binary -> 1536d, skip matryoshka)', async () => {
      // Stage 1: Binary prefilter to 100 candidates
      const binaryQuery = queryVector.map((v) => (v > 0 ? 1 : 0))
      const candidates = await vectorStore?.binarySearch(binaryQuery, { limit: 100 })

      // Stage 2: Full 1536d for final 10
      const results = await vectorStore?.refineSearch(
        queryVector,
        candidates || [],
        { limit: 10 }
      )

      return results
    })
  })

  // =========================================================================
  // LATENCY COMPARISON
  // =========================================================================

  describe('Latency Comparison by Stage', () => {
    bench('measure binary stage latency', async () => {
      const start = performance.now()
      const binaryQuery = queryVector.map((v) => (v > 0 ? 1 : 0))
      await vectorStore?.binarySearch(binaryQuery, { limit: 1000 })
      const end = performance.now()
      console.log(`Binary stage: ${(end - start).toFixed(2)}ms`)
    })

    bench('measure 64d stage latency', async () => {
      const start = performance.now()
      await vectorStore?.search({
        embedding: new Float32Array(queryVector.slice(0, 64)),
        limit: 100,
      })
      const end = performance.now()
      console.log(`64d stage: ${(end - start).toFixed(2)}ms`)
    })

    bench('measure 256d stage latency', async () => {
      const start = performance.now()
      await vectorStore?.search({
        embedding: new Float32Array(queryVector.slice(0, 256)),
        limit: 50,
      })
      const end = performance.now()
      console.log(`256d stage: ${(end - start).toFixed(2)}ms`)
    })

    bench('measure 1536d stage latency', async () => {
      const start = performance.now()
      await vectorStore?.search({
        embedding: new Float32Array(queryVector),
        limit: 10,
      })
      const end = performance.now()
      console.log(`1536d stage: ${(end - start).toFixed(2)}ms`)
    })
  })

  // =========================================================================
  // RECALL VS SPEED TRADE-OFFS
  // =========================================================================

  describe('Recall vs Speed Trade-offs', () => {
    bench('log trade-off summary', () => {
      console.log(`
        ┌────────────────────────────────────────────────────────────────┐
        │ Progressive Vector Search: Recall vs Speed Trade-offs          │
        ├─────────────┬────────────┬───────────┬────────────┬───────────┤
        │ Stage       │ Dimensions │ Speedup   │ Est Recall │ Use Case  │
        ├─────────────┼────────────┼───────────┼────────────┼───────────┤
        │ Binary Hash │ 1536 bits  │ ~100x     │ ~85-90%    │ Prefilter │
        │ Matryoshka  │ 64d        │ ~24x      │ ~93-95%    │ Coarse    │
        │ Matryoshka  │ 256d       │ ~6x       │ ~98-99%    │ Medium    │
        │ Full        │ 1536d      │ 1x (base) │ 100%       │ Final     │
        └─────────────┴────────────┴───────────┴────────────┴───────────┘

        Optimal Pipeline for 1M vectors:
        1. Binary prefilter: 1M -> 1K candidates (~0.1ms)
        2. 64d refinement: 1K -> 100 candidates (~0.5ms)
        3. 256d refinement: 100 -> 20 candidates (~0.2ms)
        4. Full 1536d: 20 -> 10 results (~0.1ms)

        Total: ~1ms vs ~50ms for brute force 1536d search
        Recall: ~98% with proper threshold tuning
      `)
    })
  })

  // =========================================================================
  // MEMORY COMPARISON
  // =========================================================================

  describe('Memory Usage Comparison', () => {
    bench('calculate memory per vector', () => {
      const vectorCount = 1_000_000

      const full1536 = vectorCount * 1536 * 4 // float32
      const matryoshka256 = vectorCount * 256 * 4
      const matryoshka64 = vectorCount * 64 * 4
      const binary = vectorCount * 192 // 1536 bits

      console.log(`
        Memory for ${vectorCount.toLocaleString()} vectors:
        - Full 1536d (float32): ${(full1536 / 1024 / 1024 / 1024).toFixed(2)} GB
        - Matryoshka 256d: ${(matryoshka256 / 1024 / 1024 / 1024).toFixed(2)} GB
        - Matryoshka 64d: ${(matryoshka64 / 1024 / 1024 / 1024).toFixed(2)} GB
        - Binary hash: ${(binary / 1024 / 1024).toFixed(2)} MB

        Storage strategy:
        - Keep binary + 64d in DO SQLite (fast access)
        - Keep 256d in R2 (medium access)
        - Full 1536d computed on-demand or cached
      `)
    })
  })
})
