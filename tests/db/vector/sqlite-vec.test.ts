/**
 * SQLite-vec Vector Backend Tests (TDD RED Phase)
 *
 * Comprehensive tests for SQLite-vec vector backend implementation.
 * These tests define the expected API contract for:
 * - Vector insertion with Matryoshka dimensions (64, 256, 1536)
 * - KNN search with cosine similarity
 * - Batch operations (insertMany, deleteMany)
 * - Index creation and management
 * - Memory-mapped file handling for large indices
 *
 * All tests should FAIL until implementation is complete.
 *
 * @see db/vector/engines/sqlite-vec.ts (to be implemented)
 * @module tests/db/vector/sqlite-vec.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

let SQLiteVecEngine: any
let createSQLiteVecEngine: any

beforeEach(async () => {
  try {
    // Import from the non-existent engine file - this will fail until implemented
    const engineModule = await import('../../../db/vector/engines/sqlite-vec')
    SQLiteVecEngine = engineModule.SQLiteVecEngine
    createSQLiteVecEngine = engineModule.createSQLiteVecEngine
  } catch {
    SQLiteVecEngine = undefined
    createSQLiteVecEngine = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `SQLite-vec engine not implemented. Expected '${fnName}' from 'db/vector/engines/sqlite-vec'. ` +
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
 * Create a mock SQLite database for testing
 */
function createMockDb() {
  const tables = new Map<string, any[]>()
  const statements = new Map<string, any>()

  return {
    tables,
    statements,
    exec: vi.fn((sql: string) => {
      // Track CREATE TABLE statements
      const match = sql.match(/CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)
      if (match && match[1]) {
        tables.set(match[1], [])
      }
    }),
    prepare: vi.fn((sql: string) => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
      bind: vi.fn(),
      finalize: vi.fn(),
    })),
    close: vi.fn(),
  }
}

// ============================================================================
// TESTS: Engine Creation and Configuration
// ============================================================================

describe('SQLiteVecEngine - Creation and Configuration', () => {
  it('should create engine with default configuration', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db)

    expect(engine).toBeDefined()
    expect(engine.dimension).toBe(1536) // Default dimension
  })

  it('should create engine with custom dimension', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 768 })

    expect(engine.dimension).toBe(768)
  })

  it('should create engine with Matryoshka dimensions', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
    })

    expect(engine.matryoshkaDims).toEqual([64, 256, 1536])
  })

  it('should use factory function to create engine', async () => {
    assertModuleLoaded('createSQLiteVecEngine', createSQLiteVecEngine)

    const db = createMockDb()
    const engine = await createSQLiteVecEngine(db, { dimension: 1536 })

    expect(engine).toBeDefined()
    expect(engine.dimension).toBe(1536)
  })

  it('should initialize vec0 virtual table on creation', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    expect(db.exec).toHaveBeenCalled()
    const calls = db.exec.mock.calls.flat().join('\n')
    expect(calls).toMatch(/CREATE\s+VIRTUAL\s+TABLE.*vec0/i)
  })

  it('should throw error for invalid dimension', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()

    expect(() => new SQLiteVecEngine(db, { dimension: 0 })).toThrow(/invalid.*dimension/i)
    expect(() => new SQLiteVecEngine(db, { dimension: -1 })).toThrow(/invalid.*dimension/i)
  })

  it('should throw error for Matryoshka dims exceeding dimension', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()

    expect(
      () =>
        new SQLiteVecEngine(db, {
          dimension: 1536,
          matryoshkaDims: [64, 256, 2048], // 2048 > 1536
        })
    ).toThrow(/matryoshka.*dimension.*exceed/i)
  })

  it('should support distance metric configuration', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      metric: 'cosine',
    })

    expect(engine.metric).toBe('cosine')
  })

  it('should support L2 distance metric', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      metric: 'l2',
    })

    expect(engine.metric).toBe('l2')
  })

  it('should support inner product distance metric', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      metric: 'ip',
    })

    expect(engine.metric).toBe('ip')
  })
})

// ============================================================================
// TESTS: Vector Insertion with Matryoshka Dimensions
// ============================================================================

describe('SQLiteVecEngine - Vector Insertion', () => {
  it('should insert a single vector with 1536 dimensions', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const embedding = randomNormalizedVector(1536, 42)

    await engine.insert({
      id: 'vec_1536',
      embedding,
      metadata: { content: 'Full dimension vector' },
    })

    const result = await engine.get('vec_1536')
    expect(result).toBeDefined()
    expect(result.id).toBe('vec_1536')
    expect(result.embedding.length).toBe(1536)
  })

  it('should insert a vector with 64 dimensions (Matryoshka small)', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 64 })
    await engine.initialize()

    const embedding = randomNormalizedVector(64, 42)

    await engine.insert({
      id: 'vec_64',
      embedding,
      metadata: { content: 'Small Matryoshka vector' },
    })

    const result = await engine.get('vec_64')
    expect(result).toBeDefined()
    expect(result.embedding.length).toBe(64)
  })

  it('should insert a vector with 256 dimensions (Matryoshka medium)', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 256 })
    await engine.initialize()

    const embedding = randomNormalizedVector(256, 42)

    await engine.insert({
      id: 'vec_256',
      embedding,
      metadata: { content: 'Medium Matryoshka vector' },
    })

    const result = await engine.get('vec_256')
    expect(result).toBeDefined()
    expect(result.embedding.length).toBe(256)
  })

  it('should store Matryoshka truncations automatically', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
      storeMatryoshkaPrefixes: true,
    })
    await engine.initialize()

    const embedding = randomNormalizedVector(1536, 42)

    await engine.insert({
      id: 'vec_mat',
      embedding,
      metadata: { content: 'Matryoshka prefixes test' },
    })

    const result = await engine.get('vec_mat')
    expect(result.mat_64).toBeDefined()
    expect(result.mat_64.length).toBe(64)
    expect(result.mat_256).toBeDefined()
    expect(result.mat_256.length).toBe(256)
  })

  it('should reject embedding with wrong dimension', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const wrongDimEmbedding = randomNormalizedVector(768, 42)

    await expect(
      engine.insert({
        id: 'vec_wrong',
        embedding: wrongDimEmbedding,
        metadata: {},
      })
    ).rejects.toThrow(/dimension.*mismatch|expected.*1536/i)
  })

  it('should handle empty vector gracefully', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const emptyEmbedding = new Float32Array(0)

    await expect(
      engine.insert({
        id: 'vec_empty',
        embedding: emptyEmbedding,
        metadata: {},
      })
    ).rejects.toThrow(/empty.*vector|dimension.*mismatch/i)
  })

  it('should reject duplicate IDs by default', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const embedding1 = randomNormalizedVector(1536, 1)
    const embedding2 = randomNormalizedVector(1536, 2)

    await engine.insert({ id: 'vec_dup', embedding: embedding1, metadata: {} })

    await expect(
      engine.insert({ id: 'vec_dup', embedding: embedding2, metadata: {} })
    ).rejects.toThrow(/duplicate|already exists/i)
  })

  it('should support upsert for duplicate IDs', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const embedding1 = randomNormalizedVector(1536, 1)
    const embedding2 = randomNormalizedVector(1536, 2)

    await engine.insert({ id: 'vec_upsert', embedding: embedding1, metadata: { v: 1 } })
    await engine.upsert({ id: 'vec_upsert', embedding: embedding2, metadata: { v: 2 } })

    const result = await engine.get('vec_upsert')
    expect(result.metadata.v).toBe(2)
  })

  it('should store metadata as JSON', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const embedding = randomNormalizedVector(1536, 42)
    const metadata = {
      content: 'Test document',
      tags: ['ml', 'python'],
      nested: { key: 'value' },
    }

    await engine.insert({ id: 'vec_meta', embedding, metadata })

    const result = await engine.get('vec_meta')
    expect(result.metadata.content).toBe('Test document')
    expect(result.metadata.tags).toEqual(['ml', 'python'])
    expect(result.metadata.nested.key).toBe('value')
  })

  it('should validate ID is non-empty string', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const embedding = randomNormalizedVector(1536, 42)

    await expect(engine.insert({ id: '', embedding, metadata: {} })).rejects.toThrow(
      /id.*empty/i
    )
  })
})

// ============================================================================
// TESTS: KNN Search with Cosine Similarity
// ============================================================================

describe('SQLiteVecEngine - KNN Search (Cosine Similarity)', () => {
  it('should find k nearest neighbors', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536, metric: 'cosine' })
    await engine.initialize()

    // Insert 20 vectors
    for (let i = 0; i < 20; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i * 100),
        metadata: { index: i },
      })
    }

    // Search with query similar to vec_5
    const queryEmbedding = randomNormalizedVector(1536, 500)
    const results = await engine.search({
      embedding: queryEmbedding,
      k: 5,
    })

    expect(results).toHaveLength(5)
    expect(results[0].id).toBe('vec_5')
    expect(results[0].similarity).toBeCloseTo(1.0, 2)
  })

  it('should return results sorted by similarity (descending)', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536, metric: 'cosine' })
    await engine.initialize()

    for (let i = 0; i < 50; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: { index: i },
      })
    }

    const results = await engine.search({
      embedding: randomNormalizedVector(1536, 25),
      k: 10,
    })

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity)
    }
  })

  it('should include distance in search results', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536, metric: 'cosine' })
    await engine.initialize()

    await engine.insert({
      id: 'vec_1',
      embedding: randomNormalizedVector(1536, 1),
      metadata: {},
    })

    const results = await engine.search({
      embedding: randomNormalizedVector(1536, 1),
      k: 1,
    })

    expect(results[0]).toHaveProperty('similarity')
    expect(results[0]).toHaveProperty('distance')
    expect(results[0].distance).toBeCloseTo(1 - results[0].similarity, 5)
  })

  it('should apply metadata filter during search', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536, metric: 'cosine' })
    await engine.initialize()

    for (let i = 0; i < 20; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: { category: i % 2 === 0 ? 'ml' : 'web' },
      })
    }

    const results = await engine.search({
      embedding: randomNormalizedVector(1536, 10),
      k: 10,
      filter: { category: 'ml' },
    })

    for (const result of results) {
      expect(result.metadata.category).toBe('ml')
    }
  })

  it('should return empty array when no vectors exist', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const results = await engine.search({
      embedding: randomNormalizedVector(1536, 42),
      k: 10,
    })

    expect(results).toEqual([])
  })

  it('should handle k larger than vector count', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    for (let i = 0; i < 5; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
    }

    const results = await engine.search({
      embedding: randomNormalizedVector(1536, 2),
      k: 100, // Larger than 5 vectors
    })

    expect(results).toHaveLength(5)
  })

  it('should support L2 distance search', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536, metric: 'l2' })
    await engine.initialize()

    for (let i = 0; i < 10; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i * 100),
        metadata: {},
      })
    }

    const results = await engine.search({
      embedding: randomNormalizedVector(1536, 500),
      k: 3,
    })

    expect(results).toHaveLength(3)
    expect(results[0].id).toBe('vec_5')
  })

  it('should search using Matryoshka 64-dim for speed', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
      storeMatryoshkaPrefixes: true,
    })
    await engine.initialize()

    for (let i = 0; i < 100; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
    }

    const results = await engine.search({
      embedding: randomNormalizedVector(1536, 50),
      k: 10,
      useMatryoshkaDim: 64, // Use 64-dim prefix for fast search
    })

    expect(results).toHaveLength(10)
  })

  it('should search using Matryoshka 256-dim for balance', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
      storeMatryoshkaPrefixes: true,
    })
    await engine.initialize()

    for (let i = 0; i < 100; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
    }

    const results = await engine.search({
      embedding: randomNormalizedVector(1536, 50),
      k: 10,
      useMatryoshkaDim: 256, // Use 256-dim prefix for balanced search
    })

    expect(results).toHaveLength(10)
  })

  it('should support nested filter conditions', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    for (let i = 0; i < 30; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {
          category: i % 3 === 0 ? 'ml' : i % 3 === 1 ? 'web' : 'data',
          tier: i % 2 === 0 ? 'premium' : 'free',
        },
      })
    }

    const results = await engine.search({
      embedding: randomNormalizedVector(1536, 12),
      k: 10,
      filter: { category: 'ml', tier: 'premium' },
    })

    for (const result of results) {
      expect(result.metadata.category).toBe('ml')
      expect(result.metadata.tier).toBe('premium')
    }
  })
})

// ============================================================================
// TESTS: Batch Operations
// ============================================================================

describe('SQLiteVecEngine - Batch Operations', () => {
  it('should insert many vectors in batch', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const vectors = Array.from({ length: 100 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: { index: i },
    }))

    await engine.insertMany(vectors)

    const result50 = await engine.get('vec_50')
    expect(result50).toBeDefined()
    expect(result50.metadata.index).toBe(50)

    const result99 = await engine.get('vec_99')
    expect(result99).toBeDefined()
    expect(result99.metadata.index).toBe(99)
  })

  it('should insert 1000 vectors in batch efficiently', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const vectors = Array.from({ length: 1000 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: { index: i },
    }))

    const start = performance.now()
    await engine.insertMany(vectors)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(5000) // Should complete within 5 seconds

    const count = await engine.count()
    expect(count).toBe(1000)
  })

  it('should delete many vectors in batch', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Insert vectors
    for (let i = 0; i < 20; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
    }

    // Delete some in batch
    await engine.deleteMany(['vec_2', 'vec_5', 'vec_8', 'vec_15'])

    // Verify deleted
    expect(await engine.get('vec_2')).toBeNull()
    expect(await engine.get('vec_5')).toBeNull()
    expect(await engine.get('vec_8')).toBeNull()
    expect(await engine.get('vec_15')).toBeNull()

    // Verify others still exist
    expect(await engine.get('vec_0')).toBeDefined()
    expect(await engine.get('vec_10')).toBeDefined()
  })

  it('should handle empty batch insert gracefully', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    await expect(engine.insertMany([])).resolves.not.toThrow()
  })

  it('should handle empty batch delete gracefully', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    await expect(engine.deleteMany([])).resolves.not.toThrow()
  })

  it('should use transaction for batch insert', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const vectors = Array.from({ length: 50 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: {},
    }))

    await engine.insertMany(vectors)

    // Should have used BEGIN/COMMIT for transaction
    const calls = db.exec.mock.calls.flat().join('\n')
    expect(calls).toMatch(/BEGIN|TRANSACTION/i)
    expect(calls).toMatch(/COMMIT/i)
  })

  it('should rollback on batch insert failure', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Include one invalid vector to cause failure
    const vectors = [
      { id: 'vec_0', embedding: randomNormalizedVector(1536, 0), metadata: {} },
      { id: 'vec_1', embedding: randomNormalizedVector(768, 1), metadata: {} }, // Wrong dimension
      { id: 'vec_2', embedding: randomNormalizedVector(1536, 2), metadata: {} },
    ]

    await expect(engine.insertMany(vectors)).rejects.toThrow()

    // vec_0 should not exist after rollback
    const result = await engine.get('vec_0')
    expect(result).toBeNull()
  })

  it('should support batch upsert', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Insert initial vectors
    const initial = Array.from({ length: 10 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: { version: 1 },
    }))
    await engine.insertMany(initial)

    // Upsert with some updates and some new
    const updates = Array.from({ length: 15 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i + 100),
      metadata: { version: 2 },
    }))
    await engine.upsertMany(updates)

    // Check updated
    const result5 = await engine.get('vec_5')
    expect(result5.metadata.version).toBe(2)

    // Check new
    const result12 = await engine.get('vec_12')
    expect(result12).toBeDefined()
    expect(result12.metadata.version).toBe(2)
  })

  it('should return count of inserted vectors', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const vectors = Array.from({ length: 25 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: {},
    }))

    const result = await engine.insertMany(vectors)

    expect(result.inserted).toBe(25)
  })
})

// ============================================================================
// TESTS: Index Creation and Management
// ============================================================================

describe('SQLiteVecEngine - Index Management', () => {
  it('should create vec0 index on initialization', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    expect(db.exec).toHaveBeenCalled()
    const calls = db.exec.mock.calls.flat().join('\n')
    expect(calls).toMatch(/vec0/i)
  })

  it('should create index with specified dimension', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 768 })
    await engine.initialize()

    const calls = db.exec.mock.calls.flat().join('\n')
    expect(calls).toMatch(/768/i)
  })

  it('should support rebuilding index', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Insert some vectors
    for (let i = 0; i < 100; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
    }

    await engine.rebuildIndex()

    expect(db.exec).toHaveBeenCalled()
  })

  it('should support dropping and recreating index', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    await engine.dropIndex()
    const calls1 = db.exec.mock.calls.flat().join('\n')
    expect(calls1).toMatch(/DROP|delete/i)

    await engine.createIndex()
    const calls2 = db.exec.mock.calls.flat().join('\n')
    expect(calls2).toMatch(/CREATE/i)
  })

  it('should report index statistics', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    for (let i = 0; i < 50; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
    }

    const stats = await engine.getIndexStats()

    expect(stats).toHaveProperty('vectorCount')
    expect(stats.vectorCount).toBe(50)
    expect(stats).toHaveProperty('dimension')
    expect(stats.dimension).toBe(1536)
    expect(stats).toHaveProperty('metric')
    expect(stats).toHaveProperty('memoryBytes')
  })

  it('should create secondary indices for Matryoshka dimensions', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
      createMatryoshkaIndices: true,
    })
    await engine.initialize()

    const calls = db.exec.mock.calls.flat().join('\n')
    // Should create indices for 64 and 256 dims
    expect(calls).toMatch(/64/i)
    expect(calls).toMatch(/256/i)
  })

  it('should optimize index for read-heavy workloads', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    await engine.optimize({ mode: 'read' })

    expect(db.exec).toHaveBeenCalled()
  })

  it('should optimize index for write-heavy workloads', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    await engine.optimize({ mode: 'write' })

    expect(db.exec).toHaveBeenCalled()
  })

  it('should vacuum database to reclaim space', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Insert and delete vectors
    for (let i = 0; i < 100; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
    }
    await engine.deleteMany(Array.from({ length: 50 }, (_, i) => `vec_${i}`))

    await engine.vacuum()

    const calls = db.exec.mock.calls.flat().join('\n')
    expect(calls).toMatch(/VACUUM/i)
  })
})

// ============================================================================
// TESTS: Memory-Mapped File Handling
// ============================================================================

describe('SQLiteVecEngine - Memory-Mapped File Handling', () => {
  it('should support mmap mode for large indices', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      useMmap: true,
    })
    await engine.initialize()

    expect(engine.useMmap).toBe(true)
  })

  it('should set mmap_size pragma when mmap enabled', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      useMmap: true,
      mmapSize: 1024 * 1024 * 1024, // 1GB
    })
    await engine.initialize()

    const calls = db.exec.mock.calls.flat().join('\n')
    expect(calls).toMatch(/mmap_size/i)
  })

  it('should handle mmap file path configuration', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      useMmap: true,
      mmapPath: '/tmp/vectors.mmap',
    })
    await engine.initialize()

    expect(engine.mmapPath).toBe('/tmp/vectors.mmap')
  })

  it('should estimate memory usage for large vector sets', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Insert vectors
    const vectors = Array.from({ length: 1000 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: {},
    }))
    await engine.insertMany(vectors)

    const stats = await engine.getIndexStats()

    // 1000 vectors * 1536 dims * 4 bytes = ~6MB minimum
    expect(stats.memoryBytes).toBeGreaterThan(6 * 1024 * 1024)
  })

  it('should support lazy loading of vectors', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      lazyLoad: true,
    })
    await engine.initialize()

    expect(engine.lazyLoad).toBe(true)
  })

  it('should flush mmap to disk on demand', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      useMmap: true,
    })
    await engine.initialize()

    // Insert some vectors
    for (let i = 0; i < 10; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
    }

    await engine.flush()

    // Should have synced/checkpointed
    const calls = db.exec.mock.calls.flat().join('\n')
    expect(calls).toMatch(/PRAGMA.*wal_checkpoint|sync/i)
  })

  it('should handle out-of-memory gracefully', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      maxMemoryBytes: 1024, // Very small limit
    })
    await engine.initialize()

    // Should either throw or handle gracefully
    const vectors = Array.from({ length: 1000 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: {},
    }))

    await expect(engine.insertMany(vectors)).rejects.toThrow(/memory|limit/i)
  })

  it('should support cache size configuration', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      cacheSize: 10000, // 10000 pages
    })
    await engine.initialize()

    const calls = db.exec.mock.calls.flat().join('\n')
    expect(calls).toMatch(/cache_size/i)
  })

  it('should persist index to separate file', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      indexFile: '/tmp/vectors.index',
    })
    await engine.initialize()

    expect(engine.indexFile).toBe('/tmp/vectors.index')
  })
})

// ============================================================================
// TESTS: Edge Cases and Error Handling
// ============================================================================

describe('SQLiteVecEngine - Edge Cases', () => {
  it('should handle zero vector', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const zeroVector = new Float32Array(1536).fill(0)

    // Should either accept (with warning) or reject
    await expect(
      engine.insert({ id: 'vec_zero', embedding: zeroVector, metadata: {} })
    ).rejects.toThrow(/zero.*vector|magnitude/i)
  })

  it('should handle NaN values in embedding', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const nanVector = randomNormalizedVector(1536, 42)
    nanVector[0] = NaN
    nanVector[100] = NaN

    await expect(
      engine.insert({ id: 'vec_nan', embedding: nanVector, metadata: {} })
    ).rejects.toThrow(/nan|invalid/i)
  })

  it('should handle Infinity values in embedding', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const infVector = randomNormalizedVector(1536, 42)
    infVector[0] = Infinity
    infVector[100] = -Infinity

    await expect(
      engine.insert({ id: 'vec_inf', embedding: infVector, metadata: {} })
    ).rejects.toThrow(/infinity|invalid/i)
  })

  it('should handle very long IDs', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const longId = 'vec_' + 'a'.repeat(10000)
    const embedding = randomNormalizedVector(1536, 42)

    // Should either accept or reject with meaningful error
    await engine.insert({ id: longId, embedding, metadata: {} })
    const result = await engine.get(longId)
    expect(result).toBeDefined()
  })

  it('should handle special characters in ID', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const specialId = "vec_with'quote\"and\\backslash"
    const embedding = randomNormalizedVector(1536, 42)

    await engine.insert({ id: specialId, embedding, metadata: {} })
    const result = await engine.get(specialId)
    expect(result).toBeDefined()
    expect(result.id).toBe(specialId)
  })

  it('should handle concurrent inserts', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Insert 100 vectors concurrently
    const promises = Array.from({ length: 100 }, (_, i) =>
      engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
    )

    await Promise.all(promises)

    const count = await engine.count()
    expect(count).toBe(100)
  })

  it('should handle concurrent searches', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Insert vectors
    for (let i = 0; i < 100; i++) {
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
    }

    // Run 50 concurrent searches
    const promises = Array.from({ length: 50 }, (_, i) =>
      engine.search({
        embedding: randomNormalizedVector(1536, i * 2),
        k: 5,
      })
    )

    const results = await Promise.all(promises)

    for (const result of results) {
      expect(result).toHaveLength(5)
    }
  })

  it('should handle database close gracefully', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    await engine.insert({
      id: 'vec_1',
      embedding: randomNormalizedVector(1536, 1),
      metadata: {},
    })

    await engine.close()

    expect(db.close).toHaveBeenCalled()
  })

  it('should handle search with invalid dimension', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    await engine.insert({
      id: 'vec_1',
      embedding: randomNormalizedVector(1536, 1),
      metadata: {},
    })

    const wrongDimQuery = randomNormalizedVector(768, 42)

    await expect(
      engine.search({ embedding: wrongDimQuery, k: 5 })
    ).rejects.toThrow(/dimension.*mismatch/i)
  })

  it('should handle delete of non-existent vector', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Should not throw
    const result = await engine.delete('non_existent')
    expect(result).toBe(false)
  })

  it('should handle get of non-existent vector', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const result = await engine.get('non_existent')
    expect(result).toBeNull()
  })
})

// ============================================================================
// TESTS: Performance Targets
// ============================================================================

describe('SQLiteVecEngine - Performance Targets', () => {
  it('should insert single vector in < 5ms', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const times: number[] = []

    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      await engine.insert({
        id: `vec_${i}`,
        embedding: randomNormalizedVector(1536, i),
        metadata: {},
      })
      times.push(performance.now() - start)
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length
    expect(avgTime).toBeLessThan(5)
  })

  it('should batch insert 1000 vectors in < 2s', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const vectors = Array.from({ length: 1000 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: {},
    }))

    const start = performance.now()
    await engine.insertMany(vectors)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(2000)
  })

  it('should search 10000 vectors in < 50ms', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Pre-populate
    const vectors = Array.from({ length: 10000 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i),
      metadata: {},
    }))
    await engine.insertMany(vectors)

    // Measure search time
    const times: number[] = []
    for (let i = 0; i < 50; i++) {
      const start = performance.now()
      await engine.search({
        embedding: randomNormalizedVector(1536, i * 200),
        k: 10,
      })
      times.push(performance.now() - start)
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length
    expect(avgTime).toBeLessThan(50)
  })

  it('should achieve > 95% recall@10', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    // Insert known vectors
    const knownVectors = Array.from({ length: 500 }, (_, i) => ({
      id: `vec_${i}`,
      embedding: randomNormalizedVector(1536, i * 1000),
    }))

    for (const vec of knownVectors) {
      await engine.insert({
        id: vec.id,
        embedding: vec.embedding,
        metadata: { content: `Content for ${vec.id}` },
      })
    }

    // Test recall
    let correctRecalls = 0
    const numQueries = 50

    for (let q = 0; q < numQueries; q++) {
      const queryEmb = randomNormalizedVector(1536, q * 10000)

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
      const results = await engine.search({
        embedding: queryEmb,
        k: 10,
      })
      const resultIds = results.map((r: any) => r.id)

      // Count how many ground truth items are in results
      const hits = groundTruth.filter((id) => resultIds.includes(id)).length
      if (hits >= 10) correctRecalls++
    }

    const recallRate = correctRecalls / numQueries
    expect(recallRate).toBeGreaterThan(0.95)
  })

  it('should handle 100k vectors with < 100ms search latency', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, {
      dimension: 1536,
      useMmap: true,
    })
    await engine.initialize()

    // Insert 100k vectors (in batches)
    for (let batch = 0; batch < 100; batch++) {
      const vectors = Array.from({ length: 1000 }, (_, i) => ({
        id: `vec_${batch * 1000 + i}`,
        embedding: randomNormalizedVector(1536, batch * 1000 + i),
        metadata: {},
      }))
      await engine.insertMany(vectors)
    }

    const count = await engine.count()
    expect(count).toBe(100000)

    // Search should still be fast
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      await engine.search({
        embedding: randomNormalizedVector(1536, i * 5000),
        k: 10,
      })
      times.push(performance.now() - start)
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length
    expect(avgTime).toBeLessThan(100)
  })
})

// ============================================================================
// TESTS: Type Safety and Interface Compliance
// ============================================================================

describe('SQLiteVecEngine - Type Safety', () => {
  it('should implement VectorEngine interface', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })

    // Check required methods exist
    expect(typeof engine.initialize).toBe('function')
    expect(typeof engine.insert).toBe('function')
    expect(typeof engine.insertMany).toBe('function')
    expect(typeof engine.upsert).toBe('function')
    expect(typeof engine.delete).toBe('function')
    expect(typeof engine.deleteMany).toBe('function')
    expect(typeof engine.get).toBe('function')
    expect(typeof engine.search).toBe('function')
    expect(typeof engine.count).toBe('function')
    expect(typeof engine.close).toBe('function')
  })

  it('should return proper search result type', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    await engine.insert({
      id: 'vec_1',
      embedding: randomNormalizedVector(1536, 1),
      metadata: { content: 'Test' },
    })

    const results = await engine.search({
      embedding: randomNormalizedVector(1536, 1),
      k: 1,
    })

    // Check result shape
    expect(results[0]).toHaveProperty('id')
    expect(results[0]).toHaveProperty('similarity')
    expect(results[0]).toHaveProperty('distance')
    expect(results[0]).toHaveProperty('metadata')
    expect(typeof results[0].id).toBe('string')
    expect(typeof results[0].similarity).toBe('number')
    expect(typeof results[0].distance).toBe('number')
    expect(typeof results[0].metadata).toBe('object')
  })

  it('should return proper stats type', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const stats = await engine.getIndexStats()

    expect(stats).toHaveProperty('vectorCount')
    expect(stats).toHaveProperty('dimension')
    expect(stats).toHaveProperty('metric')
    expect(stats).toHaveProperty('memoryBytes')
    expect(typeof stats.vectorCount).toBe('number')
    expect(typeof stats.dimension).toBe('number')
    expect(typeof stats.metric).toBe('string')
    expect(typeof stats.memoryBytes).toBe('number')
  })

  it('should accept Float32Array embeddings', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const embedding = new Float32Array(1536)
    for (let i = 0; i < 1536; i++) {
      embedding[i] = Math.random()
    }

    await engine.insert({
      id: 'vec_f32',
      embedding,
      metadata: {},
    })

    const result = await engine.get('vec_f32')
    expect(result).toBeDefined()
    expect(result.embedding).toBeInstanceOf(Float32Array)
  })

  it('should accept regular array embeddings and convert', async () => {
    assertModuleLoaded('SQLiteVecEngine', SQLiteVecEngine)

    const db = createMockDb()
    const engine = new SQLiteVecEngine(db, { dimension: 1536 })
    await engine.initialize()

    const embedding = Array.from({ length: 1536 }, () => Math.random())

    await engine.insert({
      id: 'vec_arr',
      embedding: embedding as any,
      metadata: {},
    })

    const result = await engine.get('vec_arr')
    expect(result).toBeDefined()
    expect(result.embedding).toBeInstanceOf(Float32Array)
  })
})
