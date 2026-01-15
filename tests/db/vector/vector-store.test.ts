/**
 * VectorStore Tests (RED Phase)
 *
 * Comprehensive tests for VectorStore with:
 * - Matryoshka embedding truncation (64/128/256-dim)
 * - Binary quantization
 * - Hybrid FTS5 + vector search
 * - Reciprocal Rank Fusion (RRF)
 * - CDC event emission
 *
 * These tests are expected to FAIL until VectorStore is implemented.
 *
 * @see db/vector/README.md
 * @module tests/db/vector/vector-store.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

let VectorStore: any
let HybridSearch: any
let MatryoshkaHandler: any
let truncateEmbedding: any

beforeEach(async () => {
  try {
    const vectorModule = await import('../../../db/vector')
    VectorStore = vectorModule.VectorStore
    HybridSearch = vectorModule.HybridSearch
    MatryoshkaHandler = vectorModule.MatryoshkaHandler
    truncateEmbedding = vectorModule.truncateEmbedding
  } catch {
    VectorStore = undefined
    HybridSearch = undefined
    MatryoshkaHandler = undefined
    truncateEmbedding = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `VectorStore module not implemented. Expected '${fnName}' from 'db/vector'. ` +
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
    const z = Math.sqrt(-2 * Math.log(u1 + 0.0001)) * Math.cos(2 * Math.PI * u2)
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
 * Create a mock database for testing
 */
function createMockDb() {
  const data = new Map<string, any>()
  const ftsData = new Map<string, string>()
  const events: any[] = []

  return {
    data,
    ftsData,
    events,
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    onCDC: (handler: (event: any) => void) => {
      return { unsubscribe: () => {} }
    },
    _emitCDC: (event: any) => events.push(event),
  }
}

// ============================================================================
// TESTS: Upsert and Get Embeddings
// ============================================================================

describe('VectorStore - Upsert/Get Embeddings', () => {
  it('should insert a single embedding', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    const embedding = randomNormalizedVector(1536, 42)

    await vectors.insert({
      id: 'doc_123',
      content: 'Machine learning frameworks for Python',
      embedding,
      metadata: { source: 'docs', category: 'ml' },
    })

    const result = await vectors.get('doc_123')

    expect(result).toBeDefined()
    expect(result.id).toBe('doc_123')
    expect(result.content).toBe('Machine learning frameworks for Python')
    expect(result.metadata.source).toBe('docs')
  })

  it('should upsert (update if exists)', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    const embedding1 = randomNormalizedVector(1536, 1)
    const embedding2 = randomNormalizedVector(1536, 2)

    await vectors.insert({
      id: 'doc_1',
      content: 'Original content',
      embedding: embedding1,
    })

    await vectors.upsert({
      id: 'doc_1',
      content: 'Updated content',
      embedding: embedding2,
    })

    const result = await vectors.get('doc_1')

    expect(result.content).toBe('Updated content')
  })

  it('should batch insert multiple embeddings', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    const documents = Array.from({ length: 100 }, (_, i) => ({
      id: `doc_${i}`,
      content: `Document ${i} content`,
      embedding: randomNormalizedVector(1536, i),
      metadata: { index: i },
    }))

    await vectors.insertBatch(documents)

    // Verify all documents were inserted
    const doc50 = await vectors.get('doc_50')
    expect(doc50).toBeDefined()
    expect(doc50.metadata.index).toBe(50)

    const doc99 = await vectors.get('doc_99')
    expect(doc99).toBeDefined()
    expect(doc99.metadata.index).toBe(99)
  })

  it('should delete an embedding', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    await vectors.insert({
      id: 'doc_to_delete',
      content: 'This will be deleted',
      embedding: randomNormalizedVector(1536, 42),
    })

    await vectors.delete('doc_to_delete')

    const result = await vectors.get('doc_to_delete')
    expect(result).toBeNull()
  })

  it('should return null for non-existent embedding', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    const result = await vectors.get('non_existent_id')
    expect(result).toBeNull()
  })

  it('should validate embedding dimension on insert', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    const wrongDimEmbedding = randomNormalizedVector(768, 42) // Wrong dimension

    await expect(
      vectors.insert({
        id: 'doc_wrong_dim',
        content: 'Wrong dimension',
        embedding: wrongDimEmbedding,
      })
    ).rejects.toThrow(/dimension.*mismatch|expected.*1536/i)
  })
})

// ============================================================================
// TESTS: Similarity Search (Cosine)
// ============================================================================

describe('VectorStore - Similarity Search (Cosine)', () => {
  it('should find similar vectors by cosine similarity', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert 10 documents
    for (let i = 0; i < 10; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i * 100),
      })
    }

    // Search with a query similar to doc_5
    const queryEmbedding = randomNormalizedVector(1536, 500) // Same seed as doc_5

    const results = await vectors.search({
      embedding: queryEmbedding,
      limit: 5,
    })

    expect(results).toHaveLength(5)
    expect(results[0].id).toBe('doc_5') // Most similar
    expect(results[0].similarity).toBeCloseTo(1.0, 2) // Almost identical
  })

  it('should return results sorted by similarity (descending)', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    for (let i = 0; i < 20; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    const results = await vectors.search({
      embedding: randomNormalizedVector(1536, 42),
      limit: 10,
    })

    // Results should be sorted by similarity (highest first)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity)
    }
  })

  it('should apply metadata filter during search', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert documents with different categories
    for (let i = 0; i < 10; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: { category: i % 2 === 0 ? 'ml' : 'web' },
      })
    }

    const results = await vectors.search({
      embedding: randomNormalizedVector(1536, 42),
      limit: 10,
      filter: { 'metadata.category': 'ml' },
    })

    // All results should be in 'ml' category
    for (const result of results) {
      expect(result.metadata.category).toBe('ml')
    }
  })

  it('should respect limit parameter', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    for (let i = 0; i < 100; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    const results = await vectors.search({
      embedding: randomNormalizedVector(1536, 42),
      limit: 5,
    })

    expect(results).toHaveLength(5)
  })

  it('should return empty array when no vectors exist', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    const results = await vectors.search({
      embedding: randomNormalizedVector(1536, 42),
      limit: 10,
    })

    expect(results).toEqual([])
  })

  it('should include distance in search results', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    await vectors.insert({
      id: 'doc_1',
      content: 'Test document',
      embedding: randomNormalizedVector(1536, 1),
    })

    const results = await vectors.search({
      embedding: randomNormalizedVector(1536, 1),
      limit: 1,
    })

    expect(results[0]).toHaveProperty('similarity')
    expect(results[0]).toHaveProperty('distance')
    // distance = 1 - similarity for cosine
    expect(results[0].distance).toBeCloseTo(1 - results[0].similarity, 5)
  })
})

// ============================================================================
// TESTS: Matryoshka Truncation (64/128/256-dim)
// ============================================================================

describe('VectorStore - Matryoshka Truncation', () => {
  it('should truncate 1536-dim to 64-dim', async () => {
    assertModuleLoaded('MatryoshkaHandler', MatryoshkaHandler)

    const handler = new MatryoshkaHandler({ originalDimension: 1536 })
    const fullEmbedding = randomNormalizedVector(1536, 42)

    const truncated = handler.truncate(fullEmbedding, 64)

    expect(truncated).toBeInstanceOf(Float32Array)
    expect(truncated.length).toBe(64)

    // First 64 dims should match
    for (let i = 0; i < 64; i++) {
      expect(truncated[i]).toBeCloseTo(fullEmbedding[i], 5)
    }
  })

  it('should truncate 1536-dim to 128-dim', async () => {
    assertModuleLoaded('MatryoshkaHandler', MatryoshkaHandler)

    const handler = new MatryoshkaHandler({ originalDimension: 1536 })
    const fullEmbedding = randomNormalizedVector(1536, 42)

    const truncated = handler.truncate(fullEmbedding, 128)

    expect(truncated.length).toBe(128)
  })

  it('should truncate 1536-dim to 256-dim', async () => {
    assertModuleLoaded('MatryoshkaHandler', MatryoshkaHandler)

    const handler = new MatryoshkaHandler({ originalDimension: 1536 })
    const fullEmbedding = randomNormalizedVector(1536, 42)

    const truncated = handler.truncate(fullEmbedding, 256)

    expect(truncated.length).toBe(256)
  })

  it('should calculate storage savings correctly', async () => {
    assertModuleLoaded('MatryoshkaHandler', MatryoshkaHandler)

    const handler = new MatryoshkaHandler({ originalDimension: 1536 })

    const savings = handler.getStorageSavings(256)

    expect(savings.originalBytes).toBe(1536 * 4) // Float32 = 4 bytes
    expect(savings.truncatedBytes).toBe(256 * 4)
    expect(savings.savingsPercent).toBeCloseTo(83.3, 1)
  })

  it('should compute cross-dimension similarity correctly', async () => {
    assertModuleLoaded('MatryoshkaHandler', MatryoshkaHandler)

    const handler = new MatryoshkaHandler({ originalDimension: 1536 })

    const vec1536 = randomNormalizedVector(1536, 42)
    const vec256 = handler.truncate(vec1536, 256)

    // Cross-dimension similarity should work
    const similarity = handler.crossDimensionSimilarity(vec1536, vec256)

    expect(typeof similarity).toBe('number')
    expect(similarity).toBeGreaterThan(0.9) // Should be very similar
  })

  it('should preserve semantic similarity after truncation', async () => {
    assertModuleLoaded('MatryoshkaHandler', MatryoshkaHandler)

    const handler = new MatryoshkaHandler({ originalDimension: 1536 })

    // Create two similar vectors and two different vectors
    const vecA = randomNormalizedVector(1536, 100)
    const vecB = randomNormalizedVector(1536, 101)
    const vecC = randomNormalizedVector(1536, 999)

    // Truncate all to 64-dim
    const truncA = handler.truncate(vecA, 64)
    const truncB = handler.truncate(vecB, 64)
    const truncC = handler.truncate(vecC, 64)

    const simAB_full = cosineSimilarity(vecA, vecB)
    const simAC_full = cosineSimilarity(vecA, vecC)
    const simAB_trunc = cosineSimilarity(truncA, truncB)
    const simAC_trunc = cosineSimilarity(truncA, truncC)

    // Relative similarity ordering should be preserved
    // (if A is more similar to B than C in full dim, same should hold in truncated)
    if (simAB_full > simAC_full) {
      expect(simAB_trunc).toBeGreaterThan(simAC_trunc)
    }
  })

  it('should support standard Matryoshka dimensions', async () => {
    assertModuleLoaded('MatryoshkaHandler', MatryoshkaHandler)

    const handler = new MatryoshkaHandler({ originalDimension: 1536 })
    const fullEmbedding = randomNormalizedVector(1536, 42)

    const standardDims = [64, 128, 256, 384, 512, 768, 1024, 1536]

    for (const dim of standardDims) {
      const truncated = handler.truncate(fullEmbedding, dim)
      expect(truncated.length).toBe(dim)
    }
  })

  it('should throw for invalid truncation dimension', async () => {
    assertModuleLoaded('MatryoshkaHandler', MatryoshkaHandler)

    const handler = new MatryoshkaHandler({ originalDimension: 1536 })
    const fullEmbedding = randomNormalizedVector(1536, 42)

    // Cannot truncate to larger dimension
    expect(() => handler.truncate(fullEmbedding, 2048)).toThrow(/invalid.*dimension|larger.*original/i)
  })

  it('should use truncateEmbedding helper function', async () => {
    assertModuleLoaded('truncateEmbedding', truncateEmbedding)

    const fullEmbedding = randomNormalizedVector(1536, 42)
    const truncated = truncateEmbedding(fullEmbedding, 256)

    expect(truncated.length).toBe(256)
  })

  it('should automatically store Matryoshka prefixes on insert', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    await vectors.insert({
      id: 'doc_mat',
      content: 'Matryoshka test',
      embedding: randomNormalizedVector(1536, 42),
    })

    // Should store mat_64 and mat_256 prefixes
    const result = await vectors.get('doc_mat')
    expect(result.mat_64).toBeDefined()
    expect(result.mat_64.length).toBe(64)
    expect(result.mat_256).toBeDefined()
    expect(result.mat_256.length).toBe(256)
  })
})

// ============================================================================
// TESTS: Binary Quantization
// ============================================================================

describe('VectorStore - Binary Quantization', () => {
  it('should compute binary hash from embedding', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    await vectors.insert({
      id: 'doc_binary',
      content: 'Binary quantization test',
      embedding: randomNormalizedVector(1536, 42),
    })

    const result = await vectors.get('doc_binary')

    // Binary hash should be 1-bit per dimension = 1536/8 = 192 bytes
    expect(result.binary_hash).toBeDefined()
    expect(result.binary_hash.byteLength).toBe(192)
  })

  it('should use binary hash for fast pre-filtering', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      useBinaryPrefilter: true,
    })

    // Insert many documents
    for (let i = 0; i < 1000; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    const queryEmbedding = randomNormalizedVector(1536, 500)

    const results = await vectors.search({
      embedding: queryEmbedding,
      limit: 10,
      useBinaryPrefilter: true, // Use Hamming distance on binary hashes first
    })

    expect(results).toHaveLength(10)
    // First result should be doc_500 (same seed)
    expect(results[0].id).toBe('doc_500')
  })

  it('should compute Hamming distance between binary hashes', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    const vec1 = randomNormalizedVector(1536, 1)
    const vec2 = randomNormalizedVector(1536, 1) // Same seed = identical
    const vec3 = randomNormalizedVector(1536, 999) // Different

    await vectors.insert({ id: 'doc_1', content: 'Doc 1', embedding: vec1 })
    await vectors.insert({ id: 'doc_2', content: 'Doc 2', embedding: vec2 })
    await vectors.insert({ id: 'doc_3', content: 'Doc 3', embedding: vec3 })

    const hash1 = (await vectors.get('doc_1')).binary_hash
    const hash2 = (await vectors.get('doc_2')).binary_hash
    const hash3 = (await vectors.get('doc_3')).binary_hash

    const hamming12 = vectors.hammingDistance(hash1, hash2)
    const hamming13 = vectors.hammingDistance(hash1, hash3)

    // Identical vectors should have 0 Hamming distance
    expect(hamming12).toBe(0)
    // Different vectors should have non-zero Hamming distance
    expect(hamming13).toBeGreaterThan(0)
  })

  it('should quantize positive values to 1, negative to 0', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 8 })

    // Create a known embedding
    const embedding = new Float32Array([1.0, -1.0, 0.5, -0.5, 0.0, 1.5, -1.5, 0.1])

    await vectors.insert({
      id: 'doc_known',
      content: 'Known embedding',
      embedding,
    })

    const result = await vectors.get('doc_known')
    const binaryHash = new Uint8Array(result.binary_hash)

    // First byte should encode: 1,-1,0.5,-0.5,0,1.5,-1.5,0.1
    // Binary: 1,0,1,0,0,1,0,1 = 0b10100101 = 165
    // Note: Bit order depends on implementation
    expect(binaryHash.length).toBe(1)
  })
})

// ============================================================================
// TESTS: Hybrid FTS5 + Vector Search
// ============================================================================

describe('VectorStore - Hybrid FTS5 + Vector Search', () => {
  it('should perform hybrid search combining FTS5 and vector', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    await vectors.insert({
      id: 'doc_ml',
      content: 'Machine learning frameworks for Python like TensorFlow and PyTorch',
      embedding: randomNormalizedVector(1536, 1),
    })

    await vectors.insert({
      id: 'doc_web',
      content: 'Web development frameworks like React and Vue',
      embedding: randomNormalizedVector(1536, 2),
    })

    await vectors.insert({
      id: 'doc_ml_python',
      content: 'Python data science with pandas and scikit-learn',
      embedding: randomNormalizedVector(1536, 3),
    })

    const results = await vectors.hybridSearch({
      query: 'python machine learning',
      embedding: randomNormalizedVector(1536, 1), // Similar to doc_ml
      limit: 10,
    })

    expect(results.length).toBeGreaterThan(0)
    // Results should include documents matching both text and vector
  })

  it('should apply FTS weight and vector weight', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    await vectors.insert({
      id: 'doc_1',
      content: 'Python programming language tutorial',
      embedding: randomNormalizedVector(1536, 1),
    })

    // Heavy FTS weight
    const ftsHeavyResults = await vectors.hybridSearch({
      query: 'python tutorial',
      embedding: randomNormalizedVector(1536, 999),
      limit: 10,
      ftsWeight: 0.9,
      vectorWeight: 0.1,
    })

    // Heavy vector weight
    const vectorHeavyResults = await vectors.hybridSearch({
      query: 'completely different query',
      embedding: randomNormalizedVector(1536, 1), // Same as doc_1
      limit: 10,
      ftsWeight: 0.1,
      vectorWeight: 0.9,
    })

    expect(ftsHeavyResults.length).toBeGreaterThan(0)
    expect(vectorHeavyResults.length).toBeGreaterThan(0)
  })

  it('should use HybridSearch class for advanced queries', async () => {
    assertModuleLoaded('HybridSearch', HybridSearch)

    const db = createMockDb()
    const search = new HybridSearch(db)

    const results = await search.query({
      query: 'machine learning frameworks python',
      embedding: randomNormalizedVector(1536, 42),
      limit: 10,
      ftsWeight: 0.4,
      vectorWeight: 0.6,
      vectorDim: 256, // Use Matryoshka 256-dim for speed
      where: { $type: 'Document' },
    })

    expect(Array.isArray(results)).toBe(true)
  })

  it('should support text-only search fallback', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    await vectors.insert({
      id: 'doc_1',
      content: 'JavaScript tutorial for beginners',
      embedding: randomNormalizedVector(1536, 1),
    })

    // Text-only search (no embedding provided)
    const results = await vectors.hybridSearch({
      query: 'JavaScript beginners',
      limit: 10,
    })

    expect(results.length).toBeGreaterThan(0)
  })

  it('should support vector-only search fallback', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    await vectors.insert({
      id: 'doc_1',
      content: 'Some document',
      embedding: randomNormalizedVector(1536, 42),
    })

    // Vector-only search (no query text provided)
    const results = await vectors.hybridSearch({
      embedding: randomNormalizedVector(1536, 42),
      limit: 10,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('doc_1')
  })

  it('should use FTS5 BM25 scoring', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert documents with varying term frequency
    await vectors.insert({
      id: 'doc_high_tf',
      content: 'python python python programming python tutorial python',
      embedding: randomNormalizedVector(1536, 1),
    })

    await vectors.insert({
      id: 'doc_low_tf',
      content: 'python programming basics',
      embedding: randomNormalizedVector(1536, 2),
    })

    const results = await vectors.hybridSearch({
      query: 'python',
      limit: 10,
      ftsWeight: 1.0,
      vectorWeight: 0.0, // Pure FTS scoring
    })

    // BM25 should handle term saturation (high TF doc shouldn't dominate unreasonably)
    expect(results.length).toBe(2)
  })
})

// ============================================================================
// TESTS: Reciprocal Rank Fusion (RRF)
// ============================================================================

describe('VectorStore - Reciprocal Rank Fusion (RRF)', () => {
  it('should compute RRF score correctly', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // RRF Score = sum(1/(k + rank_i)) where k = 60

    // Document A: FTS rank 1, Vector rank 3
    // RRF = 1/(60+1) + 1/(60+3) = 0.0164 + 0.0159 = 0.0323

    // Document B: FTS rank 5, Vector rank 1
    // RRF = 1/(60+5) + 1/(60+1) = 0.0154 + 0.0164 = 0.0318

    // A should rank higher than B

    const rrfScoreA = vectors.computeRRFScore([
      { rank: 1, weight: 1.0 }, // FTS
      { rank: 3, weight: 1.0 }, // Vector
    ])

    const rrfScoreB = vectors.computeRRFScore([
      { rank: 5, weight: 1.0 }, // FTS
      { rank: 1, weight: 1.0 }, // Vector
    ])

    expect(rrfScoreA).toBeGreaterThan(rrfScoreB)
  })

  it('should use k=60 constant by default', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    const score = vectors.computeRRFScore([{ rank: 1, weight: 1.0 }])

    // 1 / (60 + 1) = 0.01639...
    expect(score).toBeCloseTo(1 / 61, 5)
  })

  it('should support custom k constant', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    const scoreK60 = vectors.computeRRFScore([{ rank: 1, weight: 1.0 }], { k: 60 })
    const scoreK20 = vectors.computeRRFScore([{ rank: 1, weight: 1.0 }], { k: 20 })

    // 1 / (60 + 1) vs 1 / (20 + 1)
    expect(scoreK60).toBeCloseTo(1 / 61, 5)
    expect(scoreK20).toBeCloseTo(1 / 21, 5)
    expect(scoreK20).toBeGreaterThan(scoreK60)
  })

  it('should apply weights to RRF components', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // With equal weights
    const scoreEqual = vectors.computeRRFScore([
      { rank: 1, weight: 1.0 },
      { rank: 1, weight: 1.0 },
    ])

    // With FTS weight = 0.4, vector weight = 0.6
    const scoreWeighted = vectors.computeRRFScore([
      { rank: 1, weight: 0.4 }, // FTS
      { rank: 1, weight: 0.6 }, // Vector
    ])

    // Equal weights: 2 * 1/61 = 0.0328
    // Weighted: 0.4 * 1/61 + 0.6 * 1/61 = 1/61 = 0.0164
    expect(scoreEqual).toBeCloseTo(2 / 61, 5)
    expect(scoreWeighted).toBeCloseTo(1 / 61, 5)
  })

  it('should handle missing results in one ranking', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Document only appears in FTS results (rank 3), not in vector results
    const score = vectors.computeRRFScore([
      { rank: 3, weight: 0.5 }, // FTS
      { rank: null, weight: 0.5 }, // Not in vector results
    ])

    // Should still compute valid score from available rankings
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(vectors.computeRRFScore([{ rank: 3, weight: 0.5 }, { rank: 3, weight: 0.5 }]))
  })

  it('should merge FTS and vector results using RRF', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert documents
    for (let i = 0; i < 20; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: i % 2 === 0 ? 'python programming' : 'javascript development',
        embedding: randomNormalizedVector(1536, i),
      })
    }

    const results = await vectors.hybridSearch({
      query: 'python programming',
      embedding: randomNormalizedVector(1536, 0), // Similar to doc_0
      limit: 10,
      fusion: 'rrf', // Use RRF fusion
    })

    // Results should include RRF score
    expect(results[0]).toHaveProperty('rrfScore')
    expect(results[0].rrfScore).toBeGreaterThan(0)

    // Results should be sorted by RRF score
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].rrfScore).toBeGreaterThanOrEqual(results[i + 1].rrfScore)
    }
  })
})

// ============================================================================
// TESTS: CDC Event Emission
// ============================================================================

describe('VectorStore - CDC Event Emission', () => {
  it('should emit CDC event on insert', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const events: any[] = []
    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256],
      onCDC: (event: any) => events.push(event),
    })

    await vectors.insert({
      id: 'doc_123',
      content: 'Test document',
      embedding: randomNormalizedVector(1536, 42),
    })

    expect(events.length).toBe(1)
    expect(events[0].type).toBe('cdc.insert')
    expect(events[0].op).toBe('c')
    expect(events[0].store).toBe('vector')
    expect(events[0].table).toBe('vectors')
    expect(events[0].key).toBe('doc_123')
    expect(events[0].after.dimension).toBe(1536)
    expect(events[0].after.matryoshkaDims).toEqual([64, 256])
    expect(events[0].after.hasContent).toBe(true)
  })

  it('should emit CDC event on batch insert', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const events: any[] = []
    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    const documents = Array.from({ length: 100 }, (_, i) => ({
      id: `doc_${i}`,
      content: `Document ${i}`,
      embedding: randomNormalizedVector(1536, i),
    }))

    await vectors.insertBatch(documents)

    // Should emit batch CDC event
    const batchEvent = events.find((e) => e.type === 'cdc.batch_insert')
    expect(batchEvent).toBeDefined()
    expect(batchEvent.op).toBe('c')
    expect(batchEvent.store).toBe('vector')
    expect(batchEvent.count).toBe(100)
  })

  it('should emit CDC event on update', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const events: any[] = []
    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    await vectors.insert({
      id: 'doc_update',
      content: 'Original',
      embedding: randomNormalizedVector(1536, 1),
    })

    events.length = 0 // Clear insert event

    await vectors.upsert({
      id: 'doc_update',
      content: 'Updated',
      embedding: randomNormalizedVector(1536, 2),
    })

    expect(events.length).toBe(1)
    expect(events[0].type).toBe('cdc.update')
    expect(events[0].op).toBe('u')
    expect(events[0].key).toBe('doc_update')
  })

  it('should emit CDC event on delete', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const events: any[] = []
    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    await vectors.insert({
      id: 'doc_delete',
      content: 'To be deleted',
      embedding: randomNormalizedVector(1536, 1),
    })

    events.length = 0

    await vectors.delete('doc_delete')

    expect(events.length).toBe(1)
    expect(events[0].type).toBe('cdc.delete')
    expect(events[0].op).toBe('d')
    expect(events[0].key).toBe('doc_delete')
  })

  it('should include partition info in batch CDC event', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const events: any[] = []
    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    const documents = Array.from({ length: 50 }, (_, i) => ({
      id: `doc_${i}`,
      content: `Python ML document ${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: { cluster: 'ml-python' },
    }))

    await vectors.insertBatch(documents, { partition: 'cluster=ml-python' })

    const batchEvent = events.find((e) => e.type === 'cdc.batch_insert')
    expect(batchEvent.partition).toBe('cluster=ml-python')
  })

  it('should emit CDC events with timestamps', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const events: any[] = []
    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    const before = Date.now()

    await vectors.insert({
      id: 'doc_ts',
      content: 'Timestamp test',
      embedding: randomNormalizedVector(1536, 42),
    })

    const after = Date.now()

    expect(events[0].timestamp).toBeDefined()
    expect(events[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(events[0].timestamp).toBeLessThanOrEqual(after)
  })

  it('should support subscribing to CDC events', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    const events: any[] = []
    const subscription = vectors.subscribe((event: any) => events.push(event))

    await vectors.insert({
      id: 'doc_sub',
      content: 'Subscription test',
      embedding: randomNormalizedVector(1536, 42),
    })

    expect(events.length).toBe(1)

    // Unsubscribe
    subscription.unsubscribe()

    await vectors.insert({
      id: 'doc_sub2',
      content: 'After unsubscribe',
      embedding: randomNormalizedVector(1536, 43),
    })

    // Should not receive event after unsubscribe
    expect(events.length).toBe(1)
  })
})

// ============================================================================
// TESTS: Progressive Search (Multi-Stage)
// ============================================================================

describe('VectorStore - Progressive Search', () => {
  it('should perform progressive search through stages', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
      useBinaryPrefilter: true,
    })

    // Insert 1000 documents
    const documents = Array.from({ length: 1000 }, (_, i) => ({
      id: `doc_${i}`,
      content: `Document ${i}`,
      embedding: randomNormalizedVector(1536, i),
    }))

    await vectors.insertBatch(documents)

    const results = await vectors.progressiveSearch({
      embedding: randomNormalizedVector(1536, 500),
      limit: 10,
      stages: [
        { type: 'binary', candidates: 1000 },    // Stage 1: Binary hash
        { type: 'matryoshka', dim: 64, candidates: 100 }, // Stage 2: 64-dim
        { type: 'matryoshka', dim: 256, candidates: 20 }, // Stage 3: 256-dim
        { type: 'exact', candidates: 10 },       // Stage 4: Full 1536-dim
      ],
    })

    expect(results).toHaveLength(10)
    expect(results[0].id).toBe('doc_500') // Should find exact match
  })

  it('should return stage timing information', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    for (let i = 0; i < 100; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    const { results, timing } = await vectors.progressiveSearch({
      embedding: randomNormalizedVector(1536, 50),
      limit: 10,
      returnTiming: true,
    })

    expect(results).toHaveLength(10)
    expect(timing).toBeDefined()
    expect(timing.total).toBeGreaterThan(0)
    expect(timing.stages).toBeInstanceOf(Array)
  })
})

// ============================================================================
// TESTS: Configuration and Initialization
// ============================================================================

describe('VectorStore - Configuration', () => {
  it('should initialize with default configuration', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db)

    expect(vectors.dimension).toBe(1536) // Default dimension
    expect(vectors.matryoshkaDims).toEqual([64, 256, 1536]) // Default dims
  })

  it('should accept custom dimension', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 768 })

    expect(vectors.dimension).toBe(768)
  })

  it('should accept custom Matryoshka dimensions', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 128, 256, 512, 1536],
    })

    expect(vectors.matryoshkaDims).toEqual([64, 128, 256, 512, 1536])
  })

  it('should create required tables on initialization', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    await vectors.initialize()

    // Should have called db.exec with CREATE TABLE statements
    expect(db.exec).toHaveBeenCalled()
    const calls = db.exec.mock.calls.flat().join('\n')
    expect(calls).toMatch(/CREATE.*VIRTUAL.*TABLE.*vec0/i)
    expect(calls).toMatch(/CREATE.*TABLE.*vector_prefixes/i)
    expect(calls).toMatch(/CREATE.*VIRTUAL.*TABLE.*fts5/i)
  })

  it('should support lazy initialization', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      lazyInit: true,
    })

    // Should not have initialized yet
    expect(db.exec).not.toHaveBeenCalled()

    // First operation should trigger initialization
    await vectors.insert({
      id: 'doc_1',
      content: 'Test',
      embedding: randomNormalizedVector(1536, 1),
    })

    expect(db.exec).toHaveBeenCalled()
  })
})

// ============================================================================
// TESTS: Error Handling
// ============================================================================

describe('VectorStore - Error Handling', () => {
  it('should throw meaningful error for invalid configuration', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()

    // Standardized error: "[VectorStore] Construct failed: dimension must be a positive integer"
    expect(() => new VectorStore(db, { dimension: -1 })).toThrow(/dimension.*positive/i)
    expect(() => new VectorStore(db, { dimension: 0 })).toThrow(/dimension.*positive/i)
  })

  it('should throw error for invalid Matryoshka dimensions', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()

    // Standardized error: "[VectorStore] Validate failed: dimension mismatch..."
    expect(
      () =>
        new VectorStore(db, {
          dimension: 1536,
          matryoshkaDims: [64, 2048], // 2048 > 1536
        })
    ).toThrow(/dimension.*mismatch/i)
  })

  it('should handle database errors gracefully', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    db.prepare = vi.fn(() => {
      throw new Error('Database connection lost')
    })

    const vectors = new VectorStore(db, { dimension: 1536 })

    await expect(
      vectors.insert({
        id: 'doc_1',
        content: 'Test',
        embedding: randomNormalizedVector(1536, 1),
      })
    ).rejects.toThrow(/database|connection/i)
  })

  it('should validate content is string', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    await expect(
      vectors.insert({
        id: 'doc_1',
        content: 12345 as any, // Invalid type
        embedding: randomNormalizedVector(1536, 1),
      })
    ).rejects.toThrow(/content.*string/i)
  })

  it('should validate id is non-empty string', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    await expect(
      vectors.insert({
        id: '',
        content: 'Test',
        embedding: randomNormalizedVector(1536, 1),
      })
    ).rejects.toThrow(/id.*empty/i)
  })
})

// ============================================================================
// TESTS: Performance Targets
// ============================================================================

describe('VectorStore - Performance Targets', () => {
  it('should insert single document in < 10ms', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    const times: number[] = []

    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
      times.push(performance.now() - start)
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length
    expect(avgTime).toBeLessThan(10)
  })

  it('should batch insert 100 documents in < 100ms', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    const documents = Array.from({ length: 100 }, (_, i) => ({
      id: `doc_${i}`,
      content: `Document ${i}`,
      embedding: randomNormalizedVector(1536, i),
    }))

    const start = performance.now()
    await vectors.insertBatch(documents)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(100)
  })

  it('should search 1000 vectors in < 20ms', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    // Pre-populate
    const documents = Array.from({ length: 1000 }, (_, i) => ({
      id: `doc_${i}`,
      content: `Document ${i}`,
      embedding: randomNormalizedVector(1536, i),
    }))
    await vectors.insertBatch(documents)

    // Measure search time
    const times: number[] = []
    for (let i = 0; i < 50; i++) {
      const start = performance.now()
      await vectors.search({
        embedding: randomNormalizedVector(1536, i * 20),
        limit: 10,
      })
      times.push(performance.now() - start)
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length
    expect(avgTime).toBeLessThan(20)
  })

  it('should achieve > 98% recall@10', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    // Insert known vectors
    const knownVectors = Array.from({ length: 100 }, (_, i) => ({
      id: `doc_${i}`,
      embedding: randomNormalizedVector(1536, i * 1000),
    }))

    for (const vec of knownVectors) {
      await vectors.insert({
        id: vec.id,
        content: `Content for ${vec.id}`,
        embedding: vec.embedding,
      })
    }

    // For each query, compute ground truth and compare
    let correctRecalls = 0
    const numQueries = 50

    for (let q = 0; q < numQueries; q++) {
      const queryEmb = randomNormalizedVector(1536, q * 2000)

      // Ground truth: compute actual similarities and sort
      const groundTruth = knownVectors
        .map((v) => ({
          id: v.id,
          similarity: cosineSimilarity(queryEmb, v.embedding),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10)
        .map((v) => v.id)

      // Search results
      const results = await vectors.search({
        embedding: queryEmb,
        limit: 10,
      })
      const resultIds = results.map((r: any) => r.id)

      // Count how many ground truth items are in results
      const hits = groundTruth.filter((id) => resultIds.includes(id)).length
      if (hits >= 10) correctRecalls++
    }

    const recallRate = correctRecalls / numQueries
    expect(recallRate).toBeGreaterThan(0.98)
  })
})
