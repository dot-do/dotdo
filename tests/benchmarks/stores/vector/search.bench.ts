/**
 * VectorStore Search Benchmarks
 *
 * RED PHASE: Benchmarks for vector similarity search operations.
 * Tests insertion, search, hybrid search, and Matryoshka compression.
 *
 * @see do-a55 - Store Benchmarks
 */

import { describe, bench, beforeAll, afterAll } from 'vitest'
import { VectorGenerator } from '../../datasets/vectors'
import { VectorStore } from '../../../../db/vector/store'
import { CostTracker } from '../../framework/cost-tracker'

describe('VectorStore Search Benchmarks', () => {
  const generator = new VectorGenerator()
  let store: VectorStore
  let tracker: CostTracker

  // Setup will fail in RED phase - no db instance available
  beforeAll(async () => {
    // RED: Will need real db instance
    // const db = await getTestDatabase()
    // store = new VectorStore(db, { dimension: 1536 })
    tracker = new CostTracker()
  })

  afterAll(async () => {
    // Cleanup
  })

  // =========================================================================
  // INSERTION OPERATIONS
  // =========================================================================

  bench('insert single vector (1536d)', async () => {
    const vec = generator.generateSync({ size: 1, dimension: 1536, seed: Date.now() })[0]
    await store.insert({
      id: `vec_${Date.now()}`,
      content: vec.content,
      embedding: new Float32Array(vec.embedding),
    })
  })

  bench('insert single vector (256d Matryoshka)', async () => {
    const vec = generator.generateSync({ size: 1, dimension: 256, seed: Date.now() })[0]
    await store.insert({
      id: `vec_256_${Date.now()}`,
      content: vec.content,
      embedding: new Float32Array(vec.embedding),
    })
  })

  bench('upsert single vector', async () => {
    const vec = generator.generateSync({ size: 1, dimension: 1536, seed: Date.now() })[0]
    await store.upsert({
      id: 'upsert_vec',
      content: vec.content,
      embedding: new Float32Array(vec.embedding),
    })
  })

  // =========================================================================
  // BATCH INSERTION
  // =========================================================================

  bench('batch insert 10 vectors (1536d)', async () => {
    const vecs = generator.generateSync({ size: 10, dimension: 1536, seed: Date.now() })
    await store.insertBatch(
      vecs.map((v, i) => ({
        id: `batch_vec_${Date.now()}_${i}`,
        content: v.content,
        embedding: new Float32Array(v.embedding),
      }))
    )
  })

  bench('batch insert 100 vectors (1536d)', async () => {
    const vecs = generator.generateSync({ size: 100, dimension: 1536, seed: Date.now() })
    await store.insertBatch(
      vecs.map((v, i) => ({
        id: `batch_vec_${Date.now()}_${i}`,
        content: v.content,
        embedding: new Float32Array(v.embedding),
      }))
    )
  })

  bench('batch insert 1000 vectors (1536d)', async () => {
    const vecs = generator.generateSync({ size: 1000, dimension: 1536, seed: Date.now() })
    await store.insertBatch(
      vecs.map((v, i) => ({
        id: `batch_vec_${Date.now()}_${i}`,
        content: v.content,
        embedding: new Float32Array(v.embedding),
      }))
    )
  })

  // =========================================================================
  // SIMILARITY SEARCH - Full Dimension
  // =========================================================================

  bench('search nearest 10 (1536d)', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.search({ embedding: query, limit: 10 })
  })

  bench('search nearest 50 (1536d)', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.search({ embedding: query, limit: 50 })
  })

  bench('search nearest 100 (1536d)', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.search({ embedding: query, limit: 100 })
  })

  // =========================================================================
  // SIMILARITY SEARCH - Matryoshka Dimensions
  // =========================================================================

  bench('search nearest 10 (256d Matryoshka)', async () => {
    const query = new Float32Array(256).map(() => Math.random())
    await store.search({ embedding: query, limit: 10 })
  })

  bench('search nearest 10 (64d Matryoshka)', async () => {
    const query = new Float32Array(64).map(() => Math.random())
    await store.search({ embedding: query, limit: 10 })
  })

  // =========================================================================
  // SEARCH WITH BINARY PREFILTER
  // =========================================================================

  bench('search with binary prefilter (1536d)', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.search({ embedding: query, limit: 10, useBinaryPrefilter: true })
  })

  bench('search with binary prefilter (256d)', async () => {
    const query = new Float32Array(256).map(() => Math.random())
    await store.search({ embedding: query, limit: 10, useBinaryPrefilter: true })
  })

  // =========================================================================
  // SEARCH WITH METADATA FILTER
  // =========================================================================

  bench('search with metadata filter', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.search({
      embedding: query,
      limit: 10,
      filter: { 'metadata.category': 'documents' },
    })
  })

  // =========================================================================
  // HYBRID SEARCH (FTS + Vector)
  // =========================================================================

  bench('hybrid search - text only', async () => {
    await store.hybridSearch({
      query: 'machine learning neural networks',
      limit: 10,
    })
  })

  bench('hybrid search - vector only', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.hybridSearch({
      embedding: query,
      limit: 10,
    })
  })

  bench('hybrid search - FTS + vector combined', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.hybridSearch({
      query: 'machine learning',
      embedding: query,
      limit: 10,
      ftsWeight: 0.3,
      vectorWeight: 0.7,
    })
  })

  bench('hybrid search - equal weights', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.hybridSearch({
      query: 'artificial intelligence',
      embedding: query,
      limit: 10,
      ftsWeight: 0.5,
      vectorWeight: 0.5,
    })
  })

  // =========================================================================
  // PROGRESSIVE SEARCH (Multi-stage)
  // =========================================================================

  bench('progressive search - binary -> matryoshka -> exact', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.progressiveSearch({
      embedding: query,
      limit: 10,
      stages: [
        { type: 'binary', candidates: 1000 },
        { type: 'matryoshka', dim: 256, candidates: 100 },
        { type: 'exact', candidates: 10 },
      ],
    })
  })

  bench('progressive search - matryoshka only', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.progressiveSearch({
      embedding: query,
      limit: 10,
      stages: [
        { type: 'matryoshka', dim: 64, candidates: 500 },
        { type: 'matryoshka', dim: 256, candidates: 50 },
        { type: 'exact', candidates: 10 },
      ],
    })
  })

  bench('progressive search with timing', async () => {
    const query = new Float32Array(1536).map(() => Math.random())
    await store.progressiveSearch({
      embedding: query,
      limit: 10,
      stages: [
        { type: 'binary', candidates: 1000 },
        { type: 'exact', candidates: 10 },
      ],
      returnTiming: true,
    })
  })

  // =========================================================================
  // RRF SCORING
  // =========================================================================

  bench('compute RRF score (2 rankings)', () => {
    store.computeRRFScore([
      { rank: 5, weight: 0.5 },
      { rank: 10, weight: 0.5 },
    ])
  })

  bench('compute RRF score (4 rankings)', () => {
    store.computeRRFScore([
      { rank: 5, weight: 0.25 },
      { rank: 10, weight: 0.25 },
      { rank: 15, weight: 0.25 },
      { rank: 20, weight: 0.25 },
    ])
  })

  // =========================================================================
  // BINARY HASH OPERATIONS
  // =========================================================================

  bench('hamming distance calculation', () => {
    const a = new ArrayBuffer(192) // 1536 bits
    const b = new ArrayBuffer(192)
    new Uint8Array(a).fill(0xAA)
    new Uint8Array(b).fill(0x55)
    store.hammingDistance(a, b)
  })

  // =========================================================================
  // GET/DELETE OPERATIONS
  // =========================================================================

  bench('get single vector by id', async () => {
    await store.get('vec_1')
  })

  bench('delete single vector', async () => {
    await store.delete('vec_to_delete')
  })
})
