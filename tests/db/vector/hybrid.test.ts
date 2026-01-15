/**
 * HybridSearch Tests (RED Phase)
 *
 * Tests for hybrid search combining FTS5 and vector similarity with RRF fusion.
 * These tests define the API contract for:
 * - addVector(id, embedding, metadata) - store a vector with metadata
 * - search(queryVector, k, filters?) - k-NN search with optional metadata filters
 * - hybridSearch(queryVector, queryText, k) - combine vector and text search
 * - deleteVector(id) - remove a vector
 * - updateMetadata(id, metadata) - update vector metadata
 * - Batch operations: addVectors(), deleteVectors()
 *
 * All tests should FAIL until implementation is complete.
 *
 * @see db/vector/README.md
 * @module tests/db/vector/hybrid.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

let HybridVectorStore: any

beforeEach(async () => {
  try {
    const vectorModule = await import('../../../db/vector')
    HybridVectorStore = vectorModule.HybridVectorStore
  } catch {
    HybridVectorStore = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `HybridVectorStore module not implemented. Expected '${fnName}' from 'db/vector'. ` +
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
// TESTS: addVector API
// ============================================================================

describe('HybridVectorStore - addVector', () => {
  it('should add a single vector with id, embedding, and metadata', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    const embedding = randomNormalizedVector(1536, 42)

    const result = await store.addVector('vec_123', embedding, {
      source: 'docs',
      category: 'ml',
      content: 'Machine learning frameworks for Python',
    })

    expect(result).toBeDefined()
    expect(result.$id).toBe('vec_123')
  })

  it('should auto-generate $id if not provided', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    const embedding = randomNormalizedVector(1536, 42)

    const result = await store.addVector(null, embedding, {
      content: 'Auto-generated ID test',
    })

    expect(result.$id).toBeDefined()
    expect(typeof result.$id).toBe('string')
    expect(result.$id.length).toBeGreaterThan(0)
  })

  it('should store Matryoshka truncated prefixes automatically', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    const embedding = randomNormalizedVector(1536, 42)

    await store.addVector('vec_mat', embedding, {
      content: 'Matryoshka test',
    })

    const stored = await store.getVector('vec_mat')
    expect(stored.mat_64).toBeDefined()
    expect(stored.mat_64.length).toBe(64)
    expect(stored.mat_256).toBeDefined()
    expect(stored.mat_256.length).toBe(256)
  })

  it('should compute binary hash for fast pre-filtering', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_binary', randomNormalizedVector(1536, 42), {
      content: 'Binary hash test',
    })

    const stored = await store.getVector('vec_binary')
    expect(stored.binaryHash).toBeDefined()
    expect(stored.binaryHash.byteLength).toBe(192) // 1536 bits / 8 = 192 bytes
  })

  it('should index content in FTS5 for text search', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_fts', randomNormalizedVector(1536, 42), {
      content: 'Machine learning frameworks TensorFlow PyTorch',
    })

    // Should be searchable via text
    const results = await store.hybridSearch(null, 'TensorFlow', 10)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].$id).toBe('vec_fts')
  })

  it('should reject embedding with wrong dimension', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    const wrongDimEmbedding = randomNormalizedVector(768, 42)

    await expect(
      store.addVector('vec_wrong', wrongDimEmbedding, { content: 'Wrong dimension' })
    ).rejects.toThrow(/dimension.*mismatch/i)
  })

  it('should emit CDC event on addVector', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const events: any[] = []
    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    await store.addVector('vec_cdc', randomNormalizedVector(1536, 42), {
      content: 'CDC test',
    })

    expect(events.length).toBe(1)
    expect(events[0].op).toBe('c')
    expect(events[0].key).toBe('vec_cdc')
  })
})

// ============================================================================
// TESTS: search API (vector-only k-NN)
// ============================================================================

describe('HybridVectorStore - search (k-NN)', () => {
  it('should find top-k similar vectors', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    // Insert 20 vectors
    for (let i = 0; i < 20; i++) {
      await store.addVector(`vec_${i}`, randomNormalizedVector(1536, i * 100), {
        content: `Document ${i}`,
      })
    }

    const queryVector = randomNormalizedVector(1536, 500) // Same seed as vec_5
    const results = await store.search(queryVector, 5)

    expect(results).toHaveLength(5)
    expect(results[0].$id).toBe('vec_5') // Most similar
    expect(results[0].similarity).toBeCloseTo(1.0, 2)
  })

  it('should return results sorted by similarity descending', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    for (let i = 0; i < 50; i++) {
      await store.addVector(`vec_${i}`, randomNormalizedVector(1536, i), {
        content: `Document ${i}`,
      })
    }

    const results = await store.search(randomNormalizedVector(1536, 25), 10)

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity)
    }
  })

  it('should apply metadata filters during search', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    for (let i = 0; i < 20; i++) {
      await store.addVector(`vec_${i}`, randomNormalizedVector(1536, i), {
        content: `Document ${i}`,
        category: i % 2 === 0 ? 'ml' : 'web',
      })
    }

    const results = await store.search(randomNormalizedVector(1536, 5), 10, {
      category: 'ml',
    })

    for (const result of results) {
      expect(result.metadata.category).toBe('ml')
    }
  })

  it('should support multiple filter conditions', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    for (let i = 0; i < 30; i++) {
      await store.addVector(`vec_${i}`, randomNormalizedVector(1536, i), {
        content: `Document ${i}`,
        category: i % 3 === 0 ? 'ml' : i % 3 === 1 ? 'web' : 'data',
        tier: i % 2 === 0 ? 'premium' : 'free',
      })
    }

    const results = await store.search(randomNormalizedVector(1536, 12), 10, {
      category: 'ml',
      tier: 'premium',
    })

    for (const result of results) {
      expect(result.metadata.category).toBe('ml')
      expect(result.metadata.tier).toBe('premium')
    }
  })

  it('should return empty array when no vectors match', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    const results = await store.search(randomNormalizedVector(1536, 42), 10)
    expect(results).toEqual([])
  })

  it('should include distance and similarity in results', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_1', randomNormalizedVector(1536, 1), {
      content: 'Test document',
    })

    const results = await store.search(randomNormalizedVector(1536, 1), 1)

    expect(results[0]).toHaveProperty('similarity')
    expect(results[0]).toHaveProperty('distance')
    expect(results[0].distance).toBeCloseTo(1 - results[0].similarity, 5)
  })

  it('should use binary pre-filter for large collections', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      useBinaryPrefilter: true,
    })

    // Insert 1000 vectors
    for (let i = 0; i < 1000; i++) {
      await store.addVector(`vec_${i}`, randomNormalizedVector(1536, i), {
        content: `Document ${i}`,
      })
    }

    const start = performance.now()
    const results = await store.search(randomNormalizedVector(1536, 500), 10)
    const duration = performance.now() - start

    expect(results).toHaveLength(10)
    expect(results[0].$id).toBe('vec_500')
    expect(duration).toBeLessThan(50) // Should be fast with pre-filtering
  })
})

// ============================================================================
// TESTS: hybridSearch API (vector + text combined)
// ============================================================================

describe('HybridVectorStore - hybridSearch', () => {
  it('should combine vector and text search with RRF', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_ml', randomNormalizedVector(1536, 1), {
      content: 'Machine learning frameworks TensorFlow PyTorch Python',
    })

    await store.addVector('vec_web', randomNormalizedVector(1536, 2), {
      content: 'Web development frameworks React Vue JavaScript',
    })

    await store.addVector('vec_data', randomNormalizedVector(1536, 3), {
      content: 'Data science Python pandas scikit-learn',
    })

    const queryVector = randomNormalizedVector(1536, 1) // Similar to vec_ml
    const results = await store.hybridSearch(queryVector, 'Python machine learning', 10)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('rrfScore')
    expect(results[0]).toHaveProperty('vectorRank')
    expect(results[0]).toHaveProperty('ftsRank')
  })

  it('should use RRF fusion formula with k=60', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    // Insert documents
    for (let i = 0; i < 10; i++) {
      await store.addVector(`vec_${i}`, randomNormalizedVector(1536, i), {
        content: i % 2 === 0 ? 'python programming' : 'javascript development',
      })
    }

    const results = await store.hybridSearch(
      randomNormalizedVector(1536, 0),
      'python programming',
      10
    )

    // RRF score = sum(1/(k + rank_i))
    // For doc ranked 1 in both: 2 * 1/61 = 0.0328
    expect(results[0].rrfScore).toBeCloseTo(2 / 61, 3)
  })

  it('should handle vector-only search when text is null', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_1', randomNormalizedVector(1536, 1), {
      content: 'Test document',
    })

    const results = await store.hybridSearch(randomNormalizedVector(1536, 1), null, 10)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].$id).toBe('vec_1')
  })

  it('should handle text-only search when vector is null', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_js', randomNormalizedVector(1536, 1), {
      content: 'JavaScript tutorial for beginners',
    })

    const results = await store.hybridSearch(null, 'JavaScript tutorial', 10)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].$id).toBe('vec_js')
  })

  it('should support custom FTS and vector weights', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_1', randomNormalizedVector(1536, 1), {
      content: 'Python programming tutorial',
    })

    // Heavy FTS weight
    const ftsHeavyResults = await store.hybridSearch(
      randomNormalizedVector(1536, 999),
      'Python programming',
      10,
      { ftsWeight: 0.9, vectorWeight: 0.1 }
    )

    // Heavy vector weight
    const vectorHeavyResults = await store.hybridSearch(
      randomNormalizedVector(1536, 1),
      'completely unrelated query',
      10,
      { ftsWeight: 0.1, vectorWeight: 0.9 }
    )

    expect(ftsHeavyResults.length).toBeGreaterThan(0)
    expect(vectorHeavyResults.length).toBeGreaterThan(0)
  })

  it('should apply metadata filters in hybrid search', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    for (let i = 0; i < 20; i++) {
      await store.addVector(`vec_${i}`, randomNormalizedVector(1536, i), {
        content: `Python programming document ${i}`,
        category: i % 2 === 0 ? 'tutorial' : 'reference',
      })
    }

    const results = await store.hybridSearch(
      randomNormalizedVector(1536, 10),
      'Python programming',
      10,
      { filters: { category: 'tutorial' } }
    )

    for (const result of results) {
      expect(result.metadata.category).toBe('tutorial')
    }
  })

  it('should use BM25 scoring for FTS component', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    // Insert documents with varying term frequency
    await store.addVector('vec_high_tf', randomNormalizedVector(1536, 1), {
      content: 'python python python programming python tutorial python',
    })

    await store.addVector('vec_low_tf', randomNormalizedVector(1536, 2), {
      content: 'python programming basics',
    })

    const results = await store.hybridSearch(null, 'python', 10)

    // Both should be returned, BM25 handles term saturation
    expect(results.length).toBe(2)
  })
})

// ============================================================================
// TESTS: deleteVector API
// ============================================================================

describe('HybridVectorStore - deleteVector', () => {
  it('should delete a vector by id', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_delete', randomNormalizedVector(1536, 42), {
      content: 'To be deleted',
    })

    await store.deleteVector('vec_delete')

    const result = await store.getVector('vec_delete')
    expect(result).toBeNull()
  })

  it('should remove from FTS index on delete', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_fts_delete', randomNormalizedVector(1536, 42), {
      content: 'Unique searchable content xyz123',
    })

    await store.deleteVector('vec_fts_delete')

    // Should not find in text search
    const results = await store.hybridSearch(null, 'xyz123', 10)
    expect(results).toHaveLength(0)
  })

  it('should emit CDC event on delete', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const events: any[] = []
    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    await store.addVector('vec_cdc_delete', randomNormalizedVector(1536, 42), {
      content: 'Delete CDC test',
    })

    events.length = 0 // Clear insert event

    await store.deleteVector('vec_cdc_delete')

    expect(events.length).toBe(1)
    expect(events[0].op).toBe('d')
    expect(events[0].key).toBe('vec_cdc_delete')
  })

  it('should handle delete of non-existent vector gracefully', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    // Should not throw
    await expect(store.deleteVector('non_existent')).resolves.not.toThrow()
  })
})

// ============================================================================
// TESTS: updateMetadata API
// ============================================================================

describe('HybridVectorStore - updateMetadata', () => {
  it('should update metadata for existing vector', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_update', randomNormalizedVector(1536, 42), {
      content: 'Original content',
      category: 'original',
    })

    await store.updateMetadata('vec_update', {
      category: 'updated',
      newField: 'added',
    })

    const result = await store.getVector('vec_update')
    expect(result.metadata.category).toBe('updated')
    expect(result.metadata.newField).toBe('added')
    expect(result.metadata.content).toBe('Original content') // Preserved
  })

  it('should update FTS index when content changes', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_content_update', randomNormalizedVector(1536, 42), {
      content: 'original unique content abc123',
    })

    await store.updateMetadata('vec_content_update', {
      content: 'updated unique content xyz789',
    })

    // Old content should not be searchable
    const oldResults = await store.hybridSearch(null, 'abc123', 10)
    expect(oldResults).toHaveLength(0)

    // New content should be searchable
    const newResults = await store.hybridSearch(null, 'xyz789', 10)
    expect(newResults.length).toBeGreaterThan(0)
    expect(newResults[0].$id).toBe('vec_content_update')
  })

  it('should emit CDC event on metadata update', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const events: any[] = []
    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    await store.addVector('vec_update_cdc', randomNormalizedVector(1536, 42), {
      content: 'Update CDC test',
    })

    events.length = 0

    await store.updateMetadata('vec_update_cdc', { category: 'updated' })

    expect(events.length).toBe(1)
    expect(events[0].op).toBe('u')
    expect(events[0].key).toBe('vec_update_cdc')
  })

  it('should throw error for non-existent vector', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await expect(
      store.updateMetadata('non_existent', { category: 'updated' })
    ).rejects.toThrow(/not found|does not exist/i)
  })

  it('should support partial metadata updates', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('vec_partial', randomNormalizedVector(1536, 42), {
      content: 'Partial update test',
      field1: 'value1',
      field2: 'value2',
      field3: 'value3',
    })

    // Only update field2
    await store.updateMetadata('vec_partial', { field2: 'updated' })

    const result = await store.getVector('vec_partial')
    expect(result.metadata.field1).toBe('value1') // Unchanged
    expect(result.metadata.field2).toBe('updated') // Changed
    expect(result.metadata.field3).toBe('value3') // Unchanged
  })
})

// ============================================================================
// TESTS: Batch Operations (addVectors, deleteVectors)
// ============================================================================

describe('HybridVectorStore - Batch Operations', () => {
  it('should batch add multiple vectors', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    const vectors = Array.from({ length: 100 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: { content: `Document ${i}`, index: i },
    }))

    await store.addVectors(vectors)

    // Verify all inserted
    const result50 = await store.getVector('vec_50')
    expect(result50).toBeDefined()
    expect(result50.metadata.index).toBe(50)

    const result99 = await store.getVector('vec_99')
    expect(result99).toBeDefined()
    expect(result99.metadata.index).toBe(99)
  })

  it('should emit single batch CDC event for addVectors', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const events: any[] = []
    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    const vectors = Array.from({ length: 50 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: { content: `Document ${i}` },
    }))

    await store.addVectors(vectors)

    // Should emit batch event, not 50 individual events
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('cdc.batch_insert')
    expect(events[0].count).toBe(50)
  })

  it('should batch delete multiple vectors', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    // Insert some vectors
    for (let i = 0; i < 10; i++) {
      await store.addVector(`vec_${i}`, randomNormalizedVector(1536, i), {
        content: `Document ${i}`,
      })
    }

    // Batch delete some of them
    await store.deleteVectors(['vec_2', 'vec_5', 'vec_8'])

    // Verify deleted
    expect(await store.getVector('vec_2')).toBeNull()
    expect(await store.getVector('vec_5')).toBeNull()
    expect(await store.getVector('vec_8')).toBeNull()

    // Verify others still exist
    expect(await store.getVector('vec_0')).toBeDefined()
    expect(await store.getVector('vec_3')).toBeDefined()
  })

  it('should emit single batch CDC event for deleteVectors', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const events: any[] = []
    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    // Insert vectors
    for (let i = 0; i < 10; i++) {
      await store.addVector(`vec_${i}`, randomNormalizedVector(1536, i), {
        content: `Document ${i}`,
      })
    }

    events.length = 0

    await store.deleteVectors(['vec_1', 'vec_3', 'vec_5'])

    expect(events.length).toBe(1)
    expect(events[0].type).toBe('cdc.batch_delete')
    expect(events[0].count).toBe(3)
  })

  it('should handle empty batch gracefully', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await expect(store.addVectors([])).resolves.not.toThrow()
    await expect(store.deleteVectors([])).resolves.not.toThrow()
  })

  it('should support partition info in batch operations', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const events: any[] = []
    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      onCDC: (event: any) => events.push(event),
    })

    const vectors = Array.from({ length: 25 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: { content: `ML Python document ${i}` },
    }))

    await store.addVectors(vectors, { partition: 'cluster=ml-python' })

    expect(events[0].partition).toBe('cluster=ml-python')
  })

  it('should batch add vectors with auto-generated IDs', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    const vectors = Array.from({ length: 10 }, (_, i) => ({
      id: null, // Auto-generate
      embedding: randomNormalizedVector(1536, i),
      metadata: { content: `Auto-ID document ${i}` },
    }))

    const results = await store.addVectors(vectors)

    expect(results).toHaveLength(10)
    for (const result of results) {
      expect(result.$id).toBeDefined()
      expect(typeof result.$id).toBe('string')
    }
  })
})

// ============================================================================
// TESTS: Progressive Search (Multi-Stage)
// ============================================================================

describe('HybridVectorStore - Progressive Search', () => {
  it('should perform multi-stage progressive search', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    // Insert 1000 vectors
    const vectors = Array.from({ length: 1000 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: { content: `Document ${i}` },
    }))

    await store.addVectors(vectors)

    const results = await store.progressiveSearch(randomNormalizedVector(1536, 500), 10, {
      stages: [
        { type: 'binary', candidates: 500 }, // Stage 1: Binary hash
        { type: 'matryoshka', dim: 64, candidates: 100 }, // Stage 2: 64-dim
        { type: 'matryoshka', dim: 256, candidates: 25 }, // Stage 3: 256-dim
        { type: 'exact', candidates: 10 }, // Stage 4: Full 1536-dim
      ],
    })

    expect(results).toHaveLength(10)
    expect(results[0].$id).toBe('vec_500')
  })

  it('should return timing information for progressive search', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    for (let i = 0; i < 100; i++) {
      await store.addVector(`vec_${i}`, randomNormalizedVector(1536, i), {
        content: `Document ${i}`,
      })
    }

    const { results, timing } = await store.progressiveSearch(
      randomNormalizedVector(1536, 50),
      10,
      { returnTiming: true }
    )

    expect(results).toHaveLength(10)
    expect(timing).toBeDefined()
    expect(timing.total).toBeGreaterThan(0)
    expect(timing.stages).toBeInstanceOf(Array)
  })
})

// ============================================================================
// TESTS: Performance Targets
// ============================================================================

describe('HybridVectorStore - Performance Targets', () => {
  it('should achieve > 98% recall@10 for progressive search', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    // Insert known vectors
    const knownVectors = Array.from({ length: 100 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i * 1000),
    }))

    for (const vec of knownVectors) {
      await store.addVector(vec.id, vec.embedding, { content: `Content for ${vec.id}` })
    }

    // Test recall
    let correctRecalls = 0
    const numQueries = 50

    for (let q = 0; q < numQueries; q++) {
      const queryEmb = randomNormalizedVector(1536, q * 2000)

      // Ground truth
      const groundTruth = knownVectors
        .map((v) => ({
          id: v.id,
          similarity: cosineSimilarity(queryEmb, v.embedding),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10)
        .map((v) => v.id)

      const results = await store.search(queryEmb, 10)
      const resultIds = results.map((r: any) => r.$id)

      const hits = groundTruth.filter((id) => resultIds.includes(id)).length
      if (hits >= 10) correctRecalls++
    }

    const recallRate = correctRecalls / numQueries
    expect(recallRate).toBeGreaterThan(0.98)
  })

  it('should complete hybrid search in < 50ms for 1000 vectors', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    // Insert 1000 vectors
    const vectors = Array.from({ length: 1000 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: { content: `Python machine learning document ${i}` },
    }))

    await store.addVectors(vectors)

    // Measure hybrid search time
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      await store.hybridSearch(randomNormalizedVector(1536, i * 50), 'Python machine learning', 10)
      times.push(performance.now() - start)
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length
    expect(avgTime).toBeLessThan(50)
  })
})

// ============================================================================
// TESTS: Type Safety (RED Phase - HybridVectorStore any usage)
// ============================================================================

describe('HybridVectorStore - Type Safety', () => {
  it('should accept SqlStorageInterface for db parameter', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    // Create a properly typed mock db that satisfies SqlStorageInterface
    const typedDb = {
      exec: vi.fn((sql: string) => {}),
      prepare: vi.fn((sql: string) => ({
        run: vi.fn((...params: unknown[]) => {}),
        get: vi.fn((...params: unknown[]) => undefined as unknown),
        all: vi.fn((...params: unknown[]) => [] as unknown[]),
      })),
    }

    // This should compile without type errors
    const store = new HybridVectorStore(typedDb, { dimension: 1536 })
    expect(store).toBeDefined()
  })

  it('should enforce proper typing for metadata parameter', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    const embedding = randomNormalizedVector(1536, 42)

    // Metadata should accept Record<string, unknown>
    const metadata = {
      content: 'Test content',
      tags: ['tag1', 'tag2'],
      count: 42,
      nested: { key: 'value' },
    }

    const result = await store.addVector('typed_vec', embedding, metadata)
    expect(result.$id).toBe('typed_vec')

    const stored = await store.getVector('typed_vec')
    expect(stored.metadata.content).toBe('Test content')
    expect(stored.metadata.tags).toEqual(['tag1', 'tag2'])
    expect(stored.metadata.count).toBe(42)
  })

  it('should type filters parameter properly in search', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('filter_test', randomNormalizedVector(1536, 1), {
      content: 'Filter test',
      category: 'test',
      priority: 1,
    })

    // Filters should accept Record<string, unknown>
    const filters = {
      category: 'test',
      priority: 1,
    }

    const results = await store.search(randomNormalizedVector(1536, 1), 10, filters)
    expect(results.length).toBeGreaterThan(0)
  })

  it('should have proper return types for search results', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('return_type_test', randomNormalizedVector(1536, 1), {
      content: 'Return type test',
    })

    const results = await store.search(randomNormalizedVector(1536, 1), 10)

    // Verify result structure matches SearchResultItem
    const result = results[0]
    expect(typeof result.$id).toBe('string')
    expect(typeof result.similarity).toBe('number')
    expect(typeof result.distance).toBe('number')
    expect(typeof result.metadata).toBe('object')
  })

  it('should have proper return types for hybrid search results', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, { dimension: 1536 })

    await store.addVector('hybrid_type_test', randomNormalizedVector(1536, 1), {
      content: 'Hybrid return type test',
    })

    const results = await store.hybridSearch(
      randomNormalizedVector(1536, 1),
      'Hybrid return',
      10
    )

    // Verify result structure matches HybridSearchResultItem
    const result = results[0]
    expect(typeof result.$id).toBe('string')
    expect(typeof result.similarity).toBe('number')
    expect(typeof result.distance).toBe('number')
    expect(typeof result.metadata).toBe('object')
    expect(result.rrfScore === undefined || typeof result.rrfScore === 'number').toBe(true)
    expect(result.vectorRank === undefined || result.vectorRank === null || typeof result.vectorRank === 'number').toBe(true)
    expect(result.ftsRank === undefined || result.ftsRank === null || typeof result.ftsRank === 'number').toBe(true)
  })

  it('should have proper return types for getVector', async () => {
    assertModuleLoaded('HybridVectorStore', HybridVectorStore)

    const db = createMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256],
    })

    await store.addVector('get_type_test', randomNormalizedVector(1536, 1), {
      content: 'Get type test',
    })

    const result = await store.getVector('get_type_test')

    // Verify result structure matches VectorResult
    expect(typeof result.$id).toBe('string')
    expect(result.embedding).toBeInstanceOf(Float32Array)
    expect(typeof result.metadata).toBe('object')
    // Matryoshka fields should be Float32Array or undefined
    if (result.mat_64 !== undefined) {
      expect(result.mat_64).toBeInstanceOf(Float32Array)
    }
    if (result.mat_256 !== undefined) {
      expect(result.mat_256).toBeInstanceOf(Float32Array)
    }
    // Binary hash should be ArrayBuffer or undefined
    if (result.binaryHash !== undefined) {
      expect(result.binaryHash).toBeInstanceOf(ArrayBuffer)
    }
  })

  it('should type HybridSearch class properly', async () => {
    // Import HybridSearch
    let HybridSearchClass: any
    try {
      const vectorModule = await import('../../../db/vector')
      HybridSearchClass = vectorModule.HybridSearch
    } catch {
      HybridSearchClass = undefined
    }

    assertModuleLoaded('HybridSearch', HybridSearchClass)

    const typedDb = {
      exec: vi.fn((sql: string) => {}),
      prepare: vi.fn((sql: string) => ({
        run: vi.fn((...params: unknown[]) => {}),
        get: vi.fn((...params: unknown[]) => undefined as unknown),
        all: vi.fn((...params: unknown[]) => [] as unknown[]),
      })),
    }

    // HybridSearch should accept SqlStorageInterface
    const hybridSearch = new HybridSearchClass(typedDb)
    expect(hybridSearch).toBeDefined()
  })
})
